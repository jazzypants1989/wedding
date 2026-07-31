/** @file Unit tests for the ONNX activation-exposure tool: inspect-onnx.js's
 *  additive `nodeOutputs()` export, and expose-activations.js's append-only
 *  graph-output surgery.
 *
 *  Every fixture here is a hand-built ModelProto a few dozen to ~150 bytes
 *  long, assembled from the same write-side primitives the tool itself uses
 *  (writeVarint/tag/lengthDelimited) — never the real 38 MB/260 MB weight
 *  files. The one thing worth stress-testing at fixture scale rather than
 *  asserting in the abstract is the varint-length-prefix growth: appending an
 *  output can push a GraphProto's byte length from a 1-byte length prefix
 *  (<128) to a 2-byte one (>=128), which shifts every offset after it. A
 *  fixture engineered to cross exactly that boundary is the corruption case
 *  that matters; everything else is comparatively easy to get right.
 */

import { test } from "node:test"
import assert from "node:assert"

import { WIRE_LEN, WIRE_VARINT, fields, nodeOutputs, readVarint } from "../../scripts/vision/inspect-onnx.js"
import {
  buildValueInfo,
  exposeActivations,
  lengthDelimited,
  locateGraphField,
  parseGraphNames,
  tag,
  writeVarint,
} from "../../scripts/vision/expose-activations.js"

// --- Fixture builders: hand-assembled protobuf, mirroring the real message
// shapes (onnx.proto) at fixture scale. Reuses the tool's own write-side
// primitives, so a bug in them would show up as a self-inconsistent fixture,
// not just a false pass. ---

/**
 * A minimal NodeProto: which tensors it reads, which it writes, and its op
 * type. `name` is the optional NodeProto.name (field 3), left blank in most
 * fixtures the same way real exporters often leave it blank.
 *
 * @param {string[]} inputs
 * @param {string[]} outputs
 * @param {string} opType
 * @param {string} [name]
 * @returns {Buffer}
 */
function buildNode(inputs, outputs, opType, name = "") {
  /** @type {Buffer[]} */
  const parts = []
  for (const input of inputs) parts.push(lengthDelimited(1, Buffer.from(input, "utf8"))) // NodeProto.input
  for (const output of outputs) parts.push(lengthDelimited(2, Buffer.from(output, "utf8"))) // NodeProto.output
  if (name) parts.push(lengthDelimited(3, Buffer.from(name, "utf8"))) // NodeProto.name
  parts.push(lengthDelimited(4, Buffer.from(opType, "utf8"))) // NodeProto.op_type
  return Buffer.concat(parts)
}

/**
 * A TensorProto reduced to just a name — enough to exercise the "requested
 * name is an initializer" refusal, without any real weight bytes.
 *
 * @param {string} name
 * @returns {Buffer}
 */
function buildTensor(name) {
  return lengthDelimited(8, Buffer.from(name, "utf8")) // TensorProto.name
}

/**
 * @typedef {object} GraphSpec
 * @property {Buffer[]} nodes NodeProto bytes (unwrapped), one per node.
 * @property {string[]} inputs Graph input names.
 * @property {string[]} outputs Graph output names.
 * @property {string[]} initializers Initializer (weight) names.
 * @property {Map<string, number>} [valueInfoTypes] name -> elem_type, written as GraphProto.value_info.
 * @property {number} [namePad] Bytes of filler in GraphProto.name (field 2), for precise size tuning.
 */

/**
 * @param {GraphSpec} spec
 * @returns {Buffer}
 */
function buildGraph({ nodes, inputs, outputs, initializers, valueInfoTypes = new Map(), namePad = 0 }) {
  /** @type {Buffer[]} */
  const parts = []
  for (const node of nodes) parts.push(lengthDelimited(1, node)) // GraphProto.node
  if (namePad > 0) parts.push(lengthDelimited(2, Buffer.alloc(namePad, "p".charCodeAt(0)))) // GraphProto.name (filler)
  for (const initializer of initializers) parts.push(lengthDelimited(5, buildTensor(initializer))) // GraphProto.initializer
  for (const input of inputs) parts.push(lengthDelimited(11, buildValueInfo(input, 1))) // GraphProto.input
  for (const output of outputs) parts.push(lengthDelimited(12, buildValueInfo(output, 1))) // GraphProto.output
  for (const [name, elemType] of valueInfoTypes) parts.push(lengthDelimited(13, buildValueInfo(name, elemType))) // GraphProto.value_info
  return Buffer.concat(parts)
}

/**
 * A ModelProto carrying just the graph field, plus whatever else is asked
 * for — real files carry ir_version/producer/opset fields too, but nothing
 * this tool touches reads them, and a fixture that omits them is smaller and
 * just as valid protobuf.
 *
 * @param {Buffer} graphBytes
 * @param {Buffer[]} [trailing] Extra ModelProto-level fields, placed after the graph field.
 * @returns {Buffer}
 */
function buildModel(graphBytes, trailing = []) {
  return Buffer.concat([lengthDelimited(7, graphBytes), ...trailing]) // ModelProto.graph
}

/**
 * A fake ModelProto.opset_import (field 8) entry: just OperatorSetIdProto's
 * version (field 2), no domain. Used as a canary placed after the graph
 * field, to prove bytes past it survive the length-prefix growing a byte.
 *
 * @param {number} version
 * @returns {Buffer}
 */
function buildOpsetField(version) {
  const content = Buffer.concat([tag(2, WIRE_VARINT), writeVarint(version)])
  return lengthDelimited(8, content)
}

/**
 * A ValueInfoProto's name and elem_type — the same shape buildValueInfo
 * writes, read back directly with inspect-onnx.js's fields()/readVarint,
 * independent of expose-activations.js's own parseGraphNames. This is the
 * "inspect-onnx.js re-parses the patched buffer" check the tests need.
 *
 * @param {Buffer} buf
 * @param {{ start: number, end: number }} span
 * @returns {{ name: string, elemType: number }}
 */
function readValueInfo(buf, span) {
  let name = ""
  let elemType = 0
  for (const f of fields(buf, span.start, span.end)) {
    if (f.field === 1 && f.span) name = buf.toString("utf8", f.span.start, f.span.end)
    else if (f.field === 2 && f.span) {
      for (const type of fields(buf, f.span.start, f.span.end)) {
        if (type.field !== 1 || !type.span) continue
        for (const tensorType of fields(buf, type.span.start, type.span.end)) {
          if (tensorType.field === 1 && tensorType.value !== null) elemType = Number(tensorType.value)
        }
      }
    }
  }
  return { name, elemType }
}

// A small graph: x --Conv(w0)--> t0 --Relu--> t1 --Identity--> y.
// t0 carries a value_info entry (elem_type 6 = int32) so the "cheap
// derivation" path has something to find that differs from the float
// fallback (1); t1 has no such entry, so it exercises the fallback.
const CHAIN_NODES = [
  buildNode(["x", "w0"], ["t0"], "Conv"),
  buildNode(["t0"], ["t1"], "Relu"),
  buildNode(["t1"], ["y"], "Identity"),
]

/** @type {GraphSpec} */
const CHAIN_SPEC = {
  nodes: CHAIN_NODES,
  inputs: ["x"],
  outputs: ["y"],
  initializers: ["w0"],
  valueInfoTypes: new Map([["t0", 6]]),
}

// --- (a) nodeOutputs() ---

test("nodeOutputs finds t0, its producing op, and its inputs, in graph order", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  const nodeList = nodeOutputs(model)
  assert.deepEqual(
    nodeList.map((n) => n.opType),
    ["Conv", "Relu", "Identity"],
  )

  const conv = nodeList.find((n) => n.outputs.includes("t0"))
  assert.ok(conv, "no node reports t0 as an output")
  assert.equal(conv.opType, "Conv")
  assert.deepEqual(conv.inputs, ["x", "w0"])
})

// --- parseGraphNames / locateGraphField (used both by exposeActivations and
// by these tests, to re-parse its results) ---

test("parseGraphNames separates inputs, outputs, and initializers, and reads value_info elem_types", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  const location = locateGraphField(model)
  const names = parseGraphNames(model, { start: location.contentStart, end: location.contentEnd })
  assert.deepEqual([...names.inputs], ["x"])
  assert.deepEqual([...names.outputs], ["y"])
  assert.deepEqual([...names.initializers], ["w0"])
  assert.equal(names.valueInfoTypes.get("t0"), 6)
  assert.equal(names.valueInfoTypes.has("t1"), false)
})

test("locateGraphField finds the tag start, not just the content span", () => {
  const graphBytes = buildGraph(CHAIN_SPEC)
  const model = buildModel(graphBytes)
  const location = locateGraphField(model)
  // This fixture's ModelProto is nothing but the graph field.
  assert.equal(location.tagStart, 0)
  assert.equal(location.contentEnd - location.contentStart, graphBytes.length)
})

// --- (b) exposing a tensor: output count +1, named correctly, elem_type
// derived when a value_info entry exists ---

test("exposing t0 appends a graph output that inspect-onnx.js's own primitives re-parse", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  const before = locateGraphField(model)
  const namesBefore = parseGraphNames(model, { start: before.contentStart, end: before.contentEnd })
  assert.equal(namesBefore.outputs.size, 1)

  const { buffer: patched, appended } = exposeActivations(model, ["t0"])
  assert.deepEqual(appended, ["t0"])

  const after = locateGraphField(patched)
  const namesAfter = parseGraphNames(patched, { start: after.contentStart, end: after.contentEnd })
  assert.equal(namesAfter.outputs.size, 2, "output count must go from 1 to 2")
  assert.ok(namesAfter.outputs.has("t0"))
  assert.ok(namesAfter.outputs.has("y"), "the pre-existing output must survive untouched")

  // Independently re-parse with fields()/readVarint (not parseGraphNames) to
  // confirm t0's elem_type came from its value_info entry (6), not the
  // float fallback (1) — proving the cheap-derivation path actually ran.
  let found = false
  for (const f of fields(patched, after.contentStart, after.contentEnd)) {
    if (f.field !== 12 || !f.span) continue // GraphProto.output
    const info = readValueInfo(patched, f.span)
    if (info.name === "t0") {
      found = true
      assert.equal(info.elemType, 6)
    }
  }
  assert.ok(found, "t0 must appear among the re-parsed outputs")
})

test("a tensor with no value_info entry falls back to elem_type 1 (float)", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  const { buffer: patched } = exposeActivations(model, ["t1"])
  const location = locateGraphField(patched)
  let found = false
  for (const f of fields(patched, location.contentStart, location.contentEnd)) {
    if (f.field !== 12 || !f.span) continue
    const info = readValueInfo(patched, f.span)
    if (info.name === "t1") {
      found = true
      assert.equal(info.elemType, 1)
    }
  }
  assert.ok(found)
})

test("exposes multiple tensors in one pass and de-duplicates a repeated name", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  const { appended } = exposeActivations(model, ["t0", "t1", "t0"])
  assert.deepEqual(appended, ["t0", "t1"])
})

test("bytes outside the graph field are untouched by the splice", () => {
  const graphBytes = buildGraph(CHAIN_SPEC)
  const model = buildModel(graphBytes, [buildOpsetField(13)])
  const { buffer: patched } = exposeActivations(model, ["t0"])

  let sawOpset = false
  for (const f of fields(patched, 0, patched.length)) {
    if (f.field !== 8 || !f.span) continue
    sawOpset = true
    for (const entry of fields(patched, f.span.start, f.span.end)) {
      if (entry.field === 2 && entry.value !== null) assert.equal(Number(entry.value), 13)
    }
  }
  assert.ok(sawOpset, "the trailing opset field must survive the splice")
})

// --- (c) refusals ---

test("refuses a tensor name no node produces", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  assert.throws(
    () => exposeActivations(model, ["does-not-exist"]),
    (err) => err instanceof Error && err.message.includes("not produced by any node"),
  )
})

test("refuses a tensor that is already a graph output", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  assert.throws(
    () => exposeActivations(model, ["y"]),
    (err) => err instanceof Error && err.message.includes("already a graph output"),
  )
})

test("refuses a tensor that names a graph input", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  assert.throws(
    () => exposeActivations(model, ["x"]),
    (err) => err instanceof Error && err.message.includes("graph input"),
  )
})

test("refuses a tensor that names an initializer", () => {
  const model = buildModel(buildGraph(CHAIN_SPEC))
  assert.throws(
    () => exposeActivations(model, ["w0"]),
    (err) => err instanceof Error && err.message.includes("initializer"),
  )
})

// --- (d) the varint-width-boundary case ---

test("a graph body that crosses the 128-byte varint boundary round-trips without corrupting trailing bytes", () => {
  const boundaryNode = buildNode(["x"], ["t"], "Identity")

  /** @param {number} pad @returns {Buffer} */
  function graphAt(pad) {
    return buildGraph({ nodes: [boundaryNode], inputs: ["x"], outputs: [], initializers: [], namePad: pad })
  }

  // Grow the fixture, via harmless filler in GraphProto.name, until it sits
  // just under the 1-byte/2-byte varint-length boundary (128).
  let pad = 0
  while (graphAt(pad).length < 120) pad++
  const graphBytes = graphAt(pad)
  assert.ok(graphBytes.length < 128, `fixture must start under the boundary, got ${graphBytes.length} bytes`)
  assert.equal(writeVarint(graphBytes.length).length, 1, "fixture's own length prefix must start at 1 byte")

  const model = buildModel(graphBytes, [buildOpsetField(13)])
  const { buffer: patched } = exposeActivations(model, ["t"])

  const location = locateGraphField(patched)
  const newLength = location.contentEnd - location.contentStart
  assert.ok(newLength >= 128, `expected the append to cross the boundary, got ${newLength} bytes`)
  assert.equal(writeVarint(newLength).length, 2, "the length prefix must have grown to 2 bytes")

  // The field after the graph field must still be exactly where the new
  // (wider) length prefix says it is, and still parse cleanly — this is the
  // corruption case a naive in-place patch would get wrong.
  let sawOpset = false
  for (const f of fields(patched, 0, patched.length)) {
    if (f.field !== 8 || !f.span) continue
    sawOpset = true
    for (const entry of fields(patched, f.span.start, f.span.end)) {
      if (entry.field === 2 && entry.value !== null) assert.equal(Number(entry.value), 13)
    }
  }
  assert.ok(sawOpset, "the trailing opset field must survive the length-prefix growth")

  const names = parseGraphNames(patched, { start: location.contentStart, end: location.contentEnd })
  assert.ok(names.outputs.has("t"), "the newly exposed tensor must be present")
})

// --- write-side primitives ---

test("writeVarint round-trips through readVarint across the 1-byte/2-byte boundary", () => {
  for (const n of [0, 1, 127, 128, 300, 16383, 16384]) {
    const encoded = writeVarint(n)
    const [decoded, pos] = readVarint(encoded, 0)
    assert.equal(Number(decoded), n)
    assert.equal(pos, encoded.length)
  }
  assert.equal(writeVarint(127).length, 1)
  assert.equal(writeVarint(128).length, 2)
})

test("writeVarint refuses a negative or non-integer input", () => {
  assert.throws(() => writeVarint(-1))
  assert.throws(() => writeVarint(1.5))
})

test("lengthDelimited wraps tag + varint length + bytes, and fields() parses it back", () => {
  const payload = Buffer.from("hello", "utf8")
  const wrapped = lengthDelimited(9, payload)
  const [f] = fields(wrapped, 0, wrapped.length)
  assert.equal(f.field, 9)
  assert.equal(f.wire, WIRE_LEN)
  assert.ok(f.span)
  assert.equal(wrapped.subarray(f.span.start, f.span.end).toString("utf8"), "hello")
})
