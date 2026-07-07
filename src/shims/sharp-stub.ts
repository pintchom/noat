// Stub for transformers.js's `sharp` dependency. It is only used for image
// pipelines, which NOAT never runs — text embedding needs none of it. The
// export must be truthy: transformers checks `if (!sharp) throw ...` at load.
export default function sharpUnavailable(): never {
  throw new Error('NOAT does not bundle sharp; image pipelines are unsupported.');
}
