export function uint8ArrayToArrayBuffer(data: Uint8Array): ArrayBuffer {
	const output = new ArrayBuffer(data.byteLength)
	new Uint8Array(output).set(data)
	return output
}