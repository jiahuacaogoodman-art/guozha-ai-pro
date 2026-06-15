export function uint8ArrayToArrayBuffer(data: Uint8Array): ArrayBuffer {
	const output = new ArrayBuffer(data.byteLength)
	new Uint8Array(output).set(data)
	return output
}

export function arrayBufferLikeToArrayBuffer(
	data: ArrayBuffer | ArrayBufferView,
): ArrayBuffer {
	if (data instanceof ArrayBuffer) {
		return data
	}
	return uint8ArrayToArrayBuffer(
		new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
	)
}