/** @file Reports the structure of an ONNX file: producer, opset, graph
 *  inputs/outputs with shapes, operator histogram, distinct operator attribute
 *  signatures, and initializer parameter count.
 *
 *  Why this exists: model cards, papers and READMEs describe these files
 *  inaccurately often enough that they cannot be trusted as an implementation
 *  reference. Several claims in an earlier draft of
 *  docs/post-wedding/SPEC-vision-lab.md were wrong in ways that would each have
 *  cost days — a detector documented as anchor-based that is centre-based, an
 *  embedder documented as MobileFaceNet that is MobileNetV1. This tool is how
 *  those were caught, and it is what the re-verification checklist in
 *  docs/post-wedding/VISION-MODELS.md runs. Parse the artifact; don't cite the
 *  write-up.
 *
 *  ONNX is protobuf. This is a direct byte walk over the wire format — no
 *  schema, no codegen, no dependency — decoding only the handful of fields that
 *  answer "which kernels must I write". No regex, per the project rule.
 *
 *  Usage: node scripts/vision/inspect-onnx.js <file.onnx> [...]
 *
 *  Wire format:  https://protobuf.dev/programming-guides/encoding/
 *  Message defs: https://github.com/onnx/onnx/blob/main/onnx/onnx.proto */

/** @import * as Types from './types.js' */

import fs from "node:fs"

/** Protobuf wire types. Only VARINT and LEN carry data we decode. */
export const WIRE_VARINT = 0
export const WIRE_64BIT = 1
export const WIRE_LEN = 2
export const WIRE_32BIT = 5

/** ONNX TensorProto.DataType values, for the ones worth naming. */
const DATA_TYPES = new Map([
  [1, "f32"],
  [2, "u8"],
  [3, "i8"],
  [4, "u16"],
  [5, "i16"],
  [6, "i32"],
  [7, "i64"],
  [9, "bool"],
  [10, "f16"],
  [11, "f64"],
])

/** Report initializer values at or below this element count. */
const SMALL_TENSOR_LIMIT = 8

/**
 * @typedef {object} Span
 * @property {number} start Inclusive byte offset.
 * @property {number} end Exclusive byte offset.
 */

/**
 * @typedef {object} Field
 * @property {number} field Protobuf field number.
 * @property {number} wire Protobuf wire type.
 * @property {Span | null} span Byte range, for length-delimited and fixed-width fields.
 * @property {bigint | null} value Decoded integer, for varint fields.
 */

/**
 * @param {Buffer} buf
 * @param {number} pos
 * @returns {[bigint, number]} The decoded value, and the position after it.
 */
export function readVarint(buf, pos) {
  let result = 0n
  let shift = 0n
  for (;;) {
    if (pos >= buf.length) throw new Error("truncated varint")
    const byte = buf[pos++]
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return [result, pos]
    shift += 7n
    if (shift > 70n) throw new Error("varint too long")
  }
}

/**
 * Walks one protobuf message, yielding each field in encounter order.
 *
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} end
 * @returns {Generator<Field>}
 */
export function* fields(buf, start, end) {
  let pos = start
  while (pos < end) {
    let key
    ;[key, pos] = readVarint(buf, pos)
    const field = Number(key >> 3n)
    const wire = Number(key & 7n)
    if (wire === WIRE_VARINT) {
      let value
      ;[value, pos] = readVarint(buf, pos)
      yield { field, wire, span: null, value }
    } else if (wire === WIRE_LEN) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      const span = { start: pos, end: pos + Number(len) }
      if (span.end > end) throw new Error("length-delimited field overruns its message")
      yield { field, wire, span, value: null }
      pos = span.end
    } else if (wire === WIRE_64BIT || wire === WIRE_32BIT) {
      const span = { start: pos, end: pos + (wire === WIRE_64BIT ? 8 : 4) }
      yield { field, wire, span, value: null }
      pos = span.end
    } else {
      throw new Error(`unsupported wire type ${wire} at byte ${pos}`)
    }
  }
}

/**
 * @param {Buffer} buf
 * @param {Span} span
 * @returns {string}
 */
export function text(buf, span) {
  return buf.toString("utf8", span.start, span.end)
}

/**
 * Finds the GraphProto field (ModelProto field 7) and returns its content
 * span — the bytes strictly inside the length-delimited field, not the tag or
 * length prefix. expose-activations.js needs its own byte range on top of
 * this (where the tag begins, to rewrite the length prefix), so it does its
 * own top-level walk rather than extending this one; this export is for
 * read-side callers like nodeOutputs() below.
 *
 * @param {Buffer} buf
 * @returns {Span}
 */
export function findGraphSpan(buf) {
  for (const f of fields(buf, 0, buf.length)) {
    if (f.field === 7 && f.span) return f.span
  }
  throw new Error("no GraphProto found")
}

/**
 * Every node in the graph, in declaration order, reduced to what
 * expose-activations.js needs to resolve a tensor name back to its producing
 * op: the op type, the node's own (often blank) name, and the tensor names it
 * consumes and produces. This is data inspect() below already walks past for
 * the operator histogram — it just never returned it.
 *
 * @param {Buffer} buf
 * @returns {Types.OnnxNode[]}
 */
export function nodeOutputs(buf) {
  const graph = findGraphSpan(buf)
  /** @type {Types.OnnxNode[]} */
  const nodes = []
  for (const f of fields(buf, graph.start, graph.end)) {
    if (f.field !== 1 || !f.span) continue // GraphProto.node
    let opType = "?"
    let name = ""
    /** @type {string[]} */
    const inputs = []
    /** @type {string[]} */
    const outputs = []
    for (const node of fields(buf, f.span.start, f.span.end)) {
      if (node.field === 1 && node.span) inputs.push(text(buf, node.span)) // NodeProto.input
      else if (node.field === 2 && node.span) outputs.push(text(buf, node.span)) // NodeProto.output
      else if (node.field === 3 && node.span) name = text(buf, node.span) // NodeProto.name
      else if (node.field === 4 && node.span) opType = text(buf, node.span) // NodeProto.op_type
    }
    nodes.push({ opType, name, inputs, outputs })
  }
  return nodes
}

/**
 * Decodes a repeated int64 field, which ONNX writes packed or unpacked
 * depending on the exporter. Both shapes appear in the models we care about.
 *
 * @param {Buffer} buf
 * @param {Field} f
 * @param {number[]} into
 * @returns {void}
 */
function readInts(buf, f, into) {
  if (f.wire === WIRE_VARINT && f.value !== null) {
    into.push(Number(f.value))
    return
  }
  if (!f.span) return
  let pos = f.span.start
  while (pos < f.span.end) {
    let value
    ;[value, pos] = readVarint(buf, pos)
    into.push(Number(value))
  }
}

/**
 * Renders a ValueInfoProto as `name: dtype[dims]`. A symbolic dim keeps its
 * parameter name, which is how a dynamic-shape export announces itself.
 *
 * @param {Buffer} buf
 * @param {Span} span
 * @returns {string}
 */
function describeValueInfo(buf, span) {
  let name = "?"
  let elemType = 0
  /** @type {string[]} */
  const dims = []
  for (const f of fields(buf, span.start, span.end)) {
    if (f.field === 1 && f.span) name = text(buf, f.span)
    else if (f.field === 2 && f.span) {
      for (const type of fields(buf, f.span.start, f.span.end)) {
        if (type.field !== 1 || !type.span) continue // TypeProto.tensor_type
        for (const tensor of fields(buf, type.span.start, type.span.end)) {
          if (tensor.field === 1 && tensor.value !== null) elemType = Number(tensor.value)
          else if (tensor.field === 2 && tensor.span) {
            for (const dim of fields(buf, tensor.span.start, tensor.span.end)) {
              if (dim.field !== 1 || !dim.span) continue
              let label = "?"
              for (const value of fields(buf, dim.span.start, dim.span.end)) {
                if (value.field === 1 && value.value !== null) label = String(value.value)
                else if (value.field === 2 && value.span) label = text(buf, value.span)
              }
              dims.push(label)
            }
          }
        }
      }
    }
  }
  return `${name}: ${DATA_TYPES.get(elemType) ?? String(elemType)}[${dims.join(",")}]`
}

/**
 * Renders an AttributeProto as `name=value`. Attribute values are what
 * determine kernel requirements: strides, pads, group counts, resize mode.
 *
 * @param {Buffer} buf
 * @param {Span} span
 * @returns {string}
 */
function describeAttribute(buf, span) {
  let name = "?"
  /** @type {number | null} */
  let single = null
  /** @type {number[]} */
  const ints = []
  /** @type {number[]} */
  const floats = []
  /** @type {string[]} */
  const strings = []
  for (const f of fields(buf, span.start, span.end)) {
    if (f.field === 1 && f.span) name = text(buf, f.span)
    else if (f.field === 2 && f.span) single = buf.readFloatLE(f.span.start)
    else if (f.field === 3 && f.value !== null) ints.push(Number(f.value))
    else if (f.field === 4 && f.span) strings.push(text(buf, f.span))
    else if (f.field === 7 && f.span) {
      for (let pos = f.span.start; pos < f.span.end; pos += 4) floats.push(buf.readFloatLE(pos))
    } else if (f.field === 8) readInts(buf, f, ints)
    else if (f.field === 9 && f.span) strings.push(text(buf, f.span))
  }
  let rendered = "?"
  if (strings.length) rendered = strings.join(",")
  else if (ints.length) rendered = `[${ints.join(",")}]`
  else if (floats.length) rendered = `[${floats.join(",")}]`
  else if (single !== null) rendered = String(single)
  return `${name}=${rendered}`
}

/**
 * Decodes a TensorProto far enough to report its shape and, when it is small,
 * its values — which is how baked-in normalisation constants get read out.
 *
 * @param {Buffer} buf
 * @param {Span} span
 * @returns {{ name: string, dims: number[], values: number[] | null }}
 */
function readTensor(buf, span) {
  /** @type {number[]} */
  const dims = []
  let dataType = 0
  let name = "?"
  /** @type {Span | null} */
  let raw = null
  /** @type {number[]} */
  const floats = []
  for (const f of fields(buf, span.start, span.end)) {
    if (f.field === 1) readInts(buf, f, dims)
    else if (f.field === 2 && f.value !== null) dataType = Number(f.value)
    else if (f.field === 4 && f.span) {
      for (let pos = f.span.start; pos < f.span.end; pos += 4) floats.push(buf.readFloatLE(pos))
    } else if (f.field === 8 && f.span) name = text(buf, f.span)
    else if (f.field === 9 && f.span) raw = f.span
  }

  const count = dims.length ? dims.reduce((a, b) => a * b, 1) : 1
  /** @type {number[] | null} */
  let values = null
  if (count <= SMALL_TENSOR_LIMIT) {
    if (floats.length) {
      values = floats
    } else if (raw) {
      values = []
      for (let i = 0; i < count; i++) {
        if (dataType === 1) values.push(buf.readFloatLE(raw.start + i * 4))
        else if (dataType === 6) values.push(buf.readInt32LE(raw.start + i * 4))
        else if (dataType === 7) values.push(Number(buf.readBigInt64LE(raw.start + i * 8)))
        else {
          values = null
          break
        }
      }
    }
  }
  return { name, dims, values }
}

/**
 * @param {string} path
 * @returns {void}
 */
function inspect(path) {
  const buf = fs.readFileSync(path)
  let producer = ""
  let producerVersion = ""
  /** @type {string[]} */
  const opsets = []
  /** @type {Span | null} */
  let graph = null

  for (const f of fields(buf, 0, buf.length)) {
    if (f.field === 2 && f.span) producer = text(buf, f.span)
    else if (f.field === 3 && f.span) producerVersion = text(buf, f.span)
    else if (f.field === 7 && f.span) graph = f.span
    else if (f.field === 8 && f.span) {
      let domain = ""
      let version = "?"
      for (const entry of fields(buf, f.span.start, f.span.end)) {
        if (entry.field === 1 && entry.span) domain = text(buf, entry.span)
        else if (entry.field === 2 && entry.value !== null) version = String(entry.value)
      }
      opsets.push(`${domain || "ai.onnx"}=${version}`)
    }
  }
  if (!graph) throw new Error("no GraphProto found")

  /** @type {Map<string, number>} */
  const ops = new Map()
  /** @type {Map<string, number>} */
  const signatures = new Map()
  /** @type {string[]} */
  const graphInputs = []
  /** @type {string[]} */
  const graphOutputs = []
  /** @type {string[]} */
  const smallTensors = []
  let params = 0
  let initializers = 0

  for (const f of fields(buf, graph.start, graph.end)) {
    if (f.field === 1 && f.span) {
      let opType = "?"
      /** @type {string[]} */
      const attrs = []
      for (const node of fields(buf, f.span.start, f.span.end)) {
        if (node.field === 4 && node.span) opType = text(buf, node.span)
        else if (node.field === 5 && node.span) attrs.push(describeAttribute(buf, node.span))
      }
      ops.set(opType, (ops.get(opType) ?? 0) + 1)
      attrs.sort()
      const signature = `${opType.padEnd(20)} ${attrs.join("  ")}`.trimEnd()
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1)
    } else if (f.field === 5 && f.span) {
      initializers++
      const tensor = readTensor(buf, f.span)
      params += tensor.dims.length ? tensor.dims.reduce((a, b) => a * b, 1) : 1
      if (tensor.values) {
        smallTensors.push(`${tensor.name} [${tensor.dims.join(",")}] = ${JSON.stringify(tensor.values)}`)
      }
    } else if (f.field === 11 && f.span) graphInputs.push(describeValueInfo(buf, f.span))
    else if (f.field === 12 && f.span) graphOutputs.push(describeValueInfo(buf, f.span))
  }

  const nodeCount = [...ops.values()].reduce((a, b) => a + b, 0)

  console.log(`\n${"=".repeat(78)}`)
  console.log(`${path}  —  ${fs.statSync(path).size.toLocaleString()} bytes`)
  console.log(`producer  ${`${producer || "(unset)"} ${producerVersion}`.trim()}`)
  console.log(`opset     ${opsets.join(" ")}`)
  console.log(`params    ${(params / 1e6).toFixed(2)} M across ${initializers} initializers`)
  console.log(`nodes     ${nodeCount} across ${ops.size} op types`)

  // Weight tensors declared as graph inputs are an MXNet-export quirk: only the
  // first entry is a real runtime input. Worth seeing rather than guessing.
  console.log(`\ninputs (${graphInputs.length})`)
  for (const line of graphInputs.slice(0, 4)) console.log(`  ${line}`)
  if (graphInputs.length > 4) {
    console.log(`  … and ${graphInputs.length - 4} more (weights declared as inputs, most likely)`)
  }

  console.log(`\noutputs (${graphOutputs.length})`)
  for (const line of graphOutputs.slice(0, 12)) console.log(`  ${line}`)
  if (graphOutputs.length > 12) console.log(`  … and ${graphOutputs.length - 12} more`)

  console.log(`\noperators`)
  for (const [op, n] of [...ops.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${op.padEnd(22)} ×${n}`)
  }

  console.log(`\ndistinct attribute signatures (${signatures.size}) — this is the kernel requirement`)
  for (const [signature, n] of [...signatures.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ×${String(n).padStart(4)}  ${signature}`)
  }

  if (smallTensors.length) {
    console.log(`\nsmall initializers (≤${SMALL_TENSOR_LIMIT} elements) — normalisation constants live here`)
    for (const line of smallTensors) console.log(`  ${line}`)
  }
}

// Guarded so expose-activations.js (and the tests) can import nodeOutputs()
// and friends without running the CLI as a side effect. Direct invocation
// (`node scripts/vision/inspect-onnx.js <file>`) is unchanged.
if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = process.argv.slice(2)
  if (!paths.length) {
    console.error("usage: node scripts/vision/inspect-onnx.js <file.onnx> [...]")
    process.exit(1)
  }

  let failed = false
  for (const path of paths) {
    try {
      inspect(path)
    } catch (err) {
      failed = true
      console.error(`\n${path}: FAILED — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  process.exit(failed ? 1 : 0)
}
