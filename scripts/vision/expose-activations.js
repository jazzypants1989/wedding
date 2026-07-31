/** @file Appends intermediate tensors to a GraphProto's output list, so a
 *  stock ONNX runtime can be asked for activations it would otherwise never
 *  hand back — ORT only returns tensors that are declared graph outputs, and
 *  the hand-written-kernel verification path (SPEC-vision-lab.md §8.1,
 *  Oracle A) needs a layer-by-layer comparison against exactly those.
 *
 *  This is append-only graph-output surgery, not a graph editor: it adds
 *  ValueInfoProto entries to GraphProto.output (field 12) and rewrites the
 *  one length prefix that changes as a result. It never renumbers, reorders,
 *  or removes anything already in the file.
 *
 *  ⚠ **Dump reference activations from the same file you ship.**
 *  Block-dequantised weights are not bit-identical to the float file's — if
 *  activations come from one file and the kernels run the other, deviations
 *  are real numbers you cannot attribute to your own bug.
 *
 *  ⚠ **The block-quantised SFace file cannot run in a stock runtime as
 *  distributed.** It declares 30 *required* graph inputs — `data` plus 29
 *  weight tensors — and a generic runtime demands all of them. Use the float
 *  file as the oracle; this tool patches whichever file you point it at, but
 *  only the float file will actually load in onnxruntime-node.
 *
 *  Usage:
 *    node scripts/vision/expose-activations.js <model.onnx> --list
 *    node scripts/vision/expose-activations.js <model.onnx> --out <patched.onnx> --tensors name1,name2
 *
 *  Wire format: same byte walk as inspect-onnx.js, plus the write-side
 *  primitives (writeVarint, tag, lengthDelimited) that walk needs a
 *  counterpart for. No regex, no dependency, per the project rule. */

/** @import * as Types from './types.js' */

import fs from "node:fs"
import { WIRE_LEN, WIRE_VARINT, fields, nodeOutputs, readVarint, text } from "./inspect-onnx.js"

/**
 * @typedef {object} Span
 * @property {number} start
 * @property {number} end
 */

// --- Write-side protobuf primitives (~15 lines: the counterpart to
// inspect-onnx.js's read-side readVarint/fields) ---

/** @type {Types.writeVarint} */
export function writeVarint(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`writeVarint: expected a non-negative integer, got ${n}`)
  const bytes = []
  let value = n
  do {
    let byte = value % 128
    value = Math.floor(value / 128)
    if (value !== 0) byte |= 0x80
    bytes.push(byte)
  } while (value !== 0)
  return Buffer.from(bytes)
}

/** @type {Types.tag} */
export function tag(fieldNum, wireType) {
  // (fieldNum << 3) | wireType, via multiplication rather than bitwise so a
  // large fieldNum is never at risk of 32-bit wraparound (none in practice
  // here, but writeVarint below already avoids the same assumption).
  return writeVarint(fieldNum * 8 + wireType)
}

/** @type {Types.lengthDelimited} */
export function lengthDelimited(fieldNum, bytes) {
  return Buffer.concat([tag(fieldNum, WIRE_LEN), writeVarint(bytes.length), bytes])
}

// --- Graph-level parsing needed for validation and splicing ---

/**
 * Locates ModelProto's GraphProto field (field 7). Deliberately its own walk
 * rather than an extension of inspect-onnx.js's fields() generator: that
 * generator's Field only carries the content span, and splicing needs the
 * tag's own start too, so there is exactly one length prefix to rewrite.
 *
 * @param {Buffer} buf
 * @returns {Types.GraphFieldLocation}
 */
export function locateGraphField(buf) {
  let pos = 0
  while (pos < buf.length) {
    const tagStart = pos
    let key
    ;[key, pos] = readVarint(buf, pos)
    const field = Number(key >> 3n)
    const wire = Number(key & 7n)
    if (wire === WIRE_VARINT) {
      ;[, pos] = readVarint(buf, pos)
    } else if (wire === WIRE_LEN) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      const contentStart = pos
      const contentEnd = contentStart + Number(len)
      if (field === 7) return { tagStart, contentStart, contentEnd }
      pos = contentEnd
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4
    } else {
      throw new Error(`unsupported wire type ${wire} at byte ${tagStart}`)
    }
  }
  throw new Error("no GraphProto field (ModelProto field 7) found")
}

/**
 * A ValueInfoProto's name and elem_type, ignoring shape — all the validation
 * and elem-type lookup below needs.
 *
 * @param {Buffer} buf
 * @param {Span} span
 * @returns {{ name: string, elemType: number }}
 */
function valueInfoNameAndType(buf, span) {
  let name = ""
  let elemType = 0
  for (const f of fields(buf, span.start, span.end)) {
    if (f.field === 1 && f.span) name = text(buf, f.span) // ValueInfoProto.name
    else if (f.field === 2 && f.span) {
      for (const type of fields(buf, f.span.start, f.span.end)) {
        if (type.field !== 1 || !type.span) continue // TypeProto.tensor_type
        for (const tensor of fields(buf, type.span.start, type.span.end)) {
          if (tensor.field === 1 && tensor.value !== null) elemType = Number(tensor.value) // TensorTypeProto.elem_type
        }
      }
    }
  }
  return { name, elemType }
}

/**
 * @param {Buffer} buf
 * @param {Span} span
 * @returns {string}
 */
function tensorName(buf, span) {
  for (const f of fields(buf, span.start, span.end)) {
    if (f.field === 8 && f.span) return text(buf, f.span) // TensorProto.name
  }
  return "?"
}

/** @type {Types.parseGraphNames} */
export function parseGraphNames(buf, graph) {
  /** @type {Set<string>} */
  const inputs = new Set()
  /** @type {Set<string>} */
  const outputs = new Set()
  /** @type {Set<string>} */
  const initializers = new Set()
  /** @type {Map<string, number>} */
  const valueInfoTypes = new Map()
  for (const f of fields(buf, graph.start, graph.end)) {
    if (f.field === 11 && f.span) inputs.add(valueInfoNameAndType(buf, f.span).name) // GraphProto.input
    else if (f.field === 12 && f.span) outputs.add(valueInfoNameAndType(buf, f.span).name) // GraphProto.output
    else if (f.field === 5 && f.span) initializers.add(tensorName(buf, f.span)) // GraphProto.initializer
    else if (f.field === 13 && f.span) {
      // GraphProto.value_info: intermediate tensors some exporters annotate
      // with a dtype. Free elem_type lookup when present; absent is common.
      const { name, elemType } = valueInfoNameAndType(buf, f.span)
      if (elemType) valueInfoTypes.set(name, elemType)
    }
  }
  return { inputs, outputs, initializers, valueInfoTypes }
}

/** @type {Types.buildValueInfo} */
export function buildValueInfo(name, elemType) {
  const tensorType = Buffer.concat([tag(1, WIRE_VARINT), writeVarint(elemType)]) // TensorTypeProto.elem_type
  const typeProto = lengthDelimited(1, tensorType) // TypeProto.tensor_type
  return Buffer.concat([
    lengthDelimited(1, Buffer.from(name, "utf8")), // ValueInfoProto.name
    lengthDelimited(2, typeProto), // ValueInfoProto.type
  ])
}

/** Fallback TensorProto.DataType when no value_info entry names one: float. */
const DEFAULT_ELEM_TYPE = 1

/** @type {Types.exposeActivations} */
export function exposeActivations(buf, tensorNames) {
  const location = locateGraphField(buf)
  const graphSpan = { start: location.contentStart, end: location.contentEnd }
  const names = parseGraphNames(buf, graphSpan)

  /** @type {Set<string>} */
  const produced = new Set()
  for (const node of nodeOutputs(buf)) for (const out of node.outputs) produced.add(out)

  const requested = [...new Set(tensorNames)]
  for (const name of requested) {
    if (names.outputs.has(name)) throw new Error(`'${name}' is already a graph output`)
    if (names.inputs.has(name)) throw new Error(`'${name}' names a graph input, not an intermediate tensor`)
    if (names.initializers.has(name)) {
      throw new Error(`'${name}' is an initializer (a weight) — exposing it is meaningless`)
    }
    if (!produced.has(name)) throw new Error(`'${name}' is not produced by any node in this graph`)
  }

  const appendedFields = requested.map((name) => {
    // Cheap elem_type derivation: a matching GraphProto.value_info entry, if
    // the exporter left one. Otherwise float — ORT tolerates loose output
    // type info for a tensor it has already computed; it does not use the
    // declared elem_type to decide how to compute the tensor, only how to
    // describe it back to the caller.
    const elemType = names.valueInfoTypes.get(name) ?? DEFAULT_ELEM_TYPE
    return lengthDelimited(12, buildValueInfo(name, elemType)) // GraphProto.output
  })

  const originalGraphBytes = buf.subarray(graphSpan.start, graphSpan.end)
  const newGraphBytes = Buffer.concat([originalGraphBytes, ...appendedFields])
  const newGraphField = lengthDelimited(7, newGraphBytes) // ModelProto.graph — the one prefix that can grow a byte

  const patched = Buffer.concat([
    buf.subarray(0, location.tagStart),
    newGraphField,
    buf.subarray(location.contentEnd),
  ])

  return { buffer: patched, appended: requested }
}

// --- CLI ---

/**
 * @param {readonly string[]} argv
 * @returns {{ modelPath: string | null, outPath: string | null, tensorNames: string[], list: boolean }}
 */
function parseArgs(argv) {
  let modelPath = null
  let outPath = null
  /** @type {string[]} */
  let tensorNames = []
  let list = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--out") {
      i++
      outPath = argv[i] ?? null
    } else if (arg === "--tensors") {
      i++
      const csv = argv[i] ?? ""
      tensorNames = csv
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
    } else if (arg === "--list") {
      list = true
    } else if (!arg.startsWith("--") && modelPath === null) {
      modelPath = arg
    }
  }
  return { modelPath, outPath, tensorNames, list }
}

/**
 * @param {readonly string[]} argv
 * @returns {void}
 */
function main(argv) {
  const args = parseArgs(argv)
  if (!args.modelPath) {
    console.error(
      "usage: node scripts/vision/expose-activations.js <model.onnx> --list\n" +
        "       node scripts/vision/expose-activations.js <model.onnx> --out <patched.onnx> --tensors name1,name2",
    )
    process.exitCode = 1
    return
  }

  const buf = fs.readFileSync(args.modelPath)

  if (args.list) {
    for (const node of nodeOutputs(buf)) {
      for (const out of node.outputs) console.log(`${out}  <-  ${node.opType}`)
    }
    return
  }

  if (!args.outPath || !args.tensorNames.length) {
    console.error("--out <patched.onnx> and --tensors name1,name2 are both required (or pass --list)")
    process.exitCode = 1
    return
  }

  /** @type {Types.ExposeResult} */
  let result
  try {
    result = exposeActivations(buf, args.tensorNames)
  } catch (err) {
    console.error(`expose-activations: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }

  fs.writeFileSync(args.outPath, result.buffer)
  console.log(`${args.modelPath}  ${buf.length.toLocaleString()} bytes`)
  console.log(`${args.outPath}  ${result.buffer.length.toLocaleString()} bytes`)
  console.log(`appended outputs (${result.appended.length})`)
  for (const name of result.appended) console.log(`  ${name}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}
