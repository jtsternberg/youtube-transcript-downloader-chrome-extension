#!/usr/bin/env node

// Simple script to generate placeholder icons
// You can replace these with proper icons later

const fs = require('fs');
const path = require('path');

// Minimal PNG generator (creates a simple colored square)
function createPNG(size, r, g, b) {
	// PNG signature
	const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

	// Helper to create CRC32
	function crc32(data) {
		let crc = 0xFFFFFFFF;
		const table = [];
		for (let i = 0; i < 256; i++) {
			let c = i;
			for (let j = 0; j < 8; j++) {
				c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
			}
			table[i] = c;
		}
		for (let i = 0; i < data.length; i++) {
			crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
		}
		return (crc ^ 0xFFFFFFFF) >>> 0;
	}

	// Create chunk
	function createChunk(type, data) {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const typeBuffer = Buffer.from(type);
		const crcData = Buffer.concat([typeBuffer, data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(crcData));
		return Buffer.concat([length, typeBuffer, data, crc]);
	}

	// IHDR chunk
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);  // width
	ihdr.writeUInt32BE(size, 4);  // height
	ihdr[8] = 8;   // bit depth
	ihdr[9] = 2;   // color type (RGB)
	ihdr[10] = 0;  // compression
	ihdr[11] = 0;  // filter
	ihdr[12] = 0;  // interlace

	// IDAT chunk (uncompressed image data)
	// For simplicity, use uncompressed deflate
	const rowSize = 1 + size * 3; // filter byte + RGB for each pixel
	const rawData = Buffer.alloc(size * rowSize);

	for (let y = 0; y < size; y++) {
		const rowOffset = y * rowSize;
		rawData[rowOffset] = 0; // filter: none
		for (let x = 0; x < size; x++) {
			const pixelOffset = rowOffset + 1 + x * 3;
			// Create a simple YouTube-style play button
			const centerX = size / 2;
			const centerY = size / 2;
			const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));

			if (dist < size * 0.4) {
				// Red circle
				rawData[pixelOffset] = r;
				rawData[pixelOffset + 1] = g;
				rawData[pixelOffset + 2] = b;
			} else {
				// White background
				rawData[pixelOffset] = 255;
				rawData[pixelOffset + 1] = 255;
				rawData[pixelOffset + 2] = 255;
			}
		}
	}

	// Compress using zlib
	const zlib = require('zlib');
	const compressed = zlib.deflateSync(rawData);

	// IEND chunk
	const iend = Buffer.alloc(0);

	return Buffer.concat([
		signature,
		createChunk('IHDR', ihdr),
		createChunk('IDAT', compressed),
		createChunk('IEND', iend)
	]);
}

const imagesDir = path.join(__dirname, '..', 'images');

// Create icons
const sizes = [16, 48, 128];
sizes.forEach(size => {
	const png = createPNG(size, 255, 0, 0); // Red color (YouTube)
	const filename = path.join(imagesDir, `icon${size}.png`);
	fs.writeFileSync(filename, png);
	console.log(`Created ${filename}`);
});

console.log('Icons generated successfully!');
