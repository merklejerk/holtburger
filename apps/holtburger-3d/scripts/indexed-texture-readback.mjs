/** Read back production GLSL helpers against independently generated palette colors.
 * Runs in a disposable browser context; no DAT assets or visual acceptance are required.
 */
export function probeIndexedTextures(sources) {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 256;
	const gl = canvas.getContext("webgl2", {
		antialias: false,
		preserveDrawingBuffer: true,
	});
	if (!gl) throw Error("WebGL2 unavailable");
	try {
		gl.disable(gl.DITHER);
		function shader(type, source) {
			const compiledShader = gl.createShader(type);
			gl.shaderSource(compiledShader, source);
			gl.compileShader(compiledShader);
			if (!gl.getShaderParameter(compiledShader, gl.COMPILE_STATUS))
				throw Error(gl.getShaderInfoLog(compiledShader));
			return compiledShader;
		}
		const vertex = shader(
			gl.VERTEX_SHADER,
			`#version 300 es
 precision highp float;out vec2 vTextureCoordinate;flat out vec2 vTextureOffset;out vec4 vInstanceColor;out vec3 vLighting;out float vTranslucency;
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vTextureCoordinate=p;vTextureOffset=vec2(0);vInstanceColor=vec4(1);vLighting=vec3(1);vTranslucency=0.0;gl_Position=vec4(p*2.0-1.0,0,1);}`,
		);
		function program(fragment) {
			const linkedProgram = gl.createProgram();
			gl.attachShader(linkedProgram, vertex);
			gl.attachShader(linkedProgram, shader(gl.FRAGMENT_SHADER, fragment));
			gl.linkProgram(linkedProgram);
			if (!gl.getProgramParameter(linkedProgram, gl.LINK_STATUS))
				throw Error(gl.getProgramInfoLog(linkedProgram));
			gl.useProgram(linkedProgram);
			return linkedProgram;
		}
		function texture(unit, w, h, data, channels) {
			gl.activeTexture(gl.TEXTURE0 + unit);
			const uploadedTexture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, uploadedTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				channels === 1 ? gl.R8 : channels === 2 ? gl.RG8 : gl.RGBA8,
				w,
				h,
				0,
				channels === 1 ? gl.RED : channels === 2 ? gl.RG : gl.RGBA,
				gl.UNSIGNED_BYTE,
				data,
			);
			return uploadedTexture;
		}
		function check(label, w, h, expected) {
			gl.viewport(0, 0, w, h);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			const pixels = new Uint8Array(w * h * 4);
			gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			const error = gl.getError();
			if (error) throw Error(label + " GL error " + error);
			for (let i = 0; i < w * h; i++) {
				const expectedColor = expected(i);
				for (let c = 0; c < 4; c++)
					if (pixels[i * 4 + c] !== expectedColor[c])
						throw Error(
							label +
								" pixel " +
								i +
								" channel " +
								c +
								": " +
								pixels[i * 4 + c] +
								" != " +
								expectedColor[c],
						);
			}
			return w * h;
		}
		const results = [];
		for (const [kind, source] of Object.entries(sources)) {
			// Compile the complete production fragment stage as well as the focused readback wrapper.
			shader(gl.FRAGMENT_SHADER, source);
			const output = kind === "particle" ? "outColor" : "fragmentColor";
			// Cover every byte value, non-power-of-two rows, and the complete 16-bit index range.
			for (const side of [16, 46, 256]) {
				const indexed8 = side === 16;
				// Objects use atlas subrects; sky and particles use standalone textures.
				const origin = kind === "object" ? 7 : 0;
				const extent = side + origin;
				const palette = new Uint8Array(extent * extent * 4).fill(173);
				const channels = indexed8 ? 1 : 2;
				const indices = new Uint8Array(side * side * channels);
				for (let i = 0; i < side * side; i++) {
					const color = [i & 255, i >>> 8, (i * 37) & 255, 255];
					palette.set(
						color,
						((Math.floor(i / side) + origin) * extent + (i % side) + origin) *
							4,
					);
					indices[i * channels] = i & 255;
					if (!indexed8) indices[i * channels + 1] = i >>> 8;
				}
				const main =
					kind === "sky"
						? "paletteColor(paletteIndex())"
						: "sampleIndexedPaletteLinear(gl_FragCoord.xy / vec2(" +
							side +
							".0))";
				const paletteProgram = program(
					source.slice(0, source.indexOf("void main()")) +
						"void main(){" +
						output +
						"=" +
						main +
						";}",
				);
				const loc = (n) => gl.getUniformLocation(paletteProgram, n);
				gl.uniform1i(loc("uBase"), 0);
				gl.uniform1i(loc("uPalette"), 1);
				gl.uniform1i(
					loc("uMaterialKind"),
					kind === "sky" ? (indexed8 ? 1 : 2) : indexed8 ? 2 : 3,
				);
				gl.uniform1i(loc("uPalettedClipMap"), 0);
				gl.uniform1i(loc("uWrapRepeat"), 1);
				gl.uniform4f(loc("uBaseRect"), 0, 0, side, side);
				gl.uniform4f(loc("uPaletteRect"), origin, origin, side, side);
				const base = texture(0, side, side, indices, channels),
					pal = texture(1, extent, extent, palette, 4);
				const count = check(kind + "/" + side, side, side, (i) => [
					i & 255,
					i >>> 8,
					(i * 37) & 255,
					255,
				]);
				results.push({ kind, side, count });
				if (kind === "object" && side === 46) {
					for (let i = 256; i < 320; i++)
						palette[
							((Math.floor(i / side) + origin) * extent + (i % side) + origin) *
								4 +
								2
						] ^= 255;
					gl.texSubImage2D(
						gl.TEXTURE_2D,
						0,
						0,
						0,
						extent,
						extent,
						gl.RGBA,
						gl.UNSIGNED_BYTE,
						palette,
					);
					check("eye-range-update", side, side, (i) => [
						i & 255,
						i >>> 8,
						((i * 37) & 255) ^ (i >= 256 && i < 320 ? 255 : 0),
						255,
					]);
					results.push({
						kind: "eye-range-update",
						count: side * side,
						hairEntriesUnchanged: 64,
					});
				}
				// Exercise cutout entries through the production palette lookup.
				// Replace only main to isolate production helpers from lighting and pass composition.
				const guard = program(
					source.slice(0, source.indexOf("void main()")) +
						"uniform int uProbeOffset;" +
						"void main(){" +
						output +
						"=paletteColor(int(gl_FragCoord.x)+uProbeOffset);}",
				);
				const guardLoc = (n) => gl.getUniformLocation(guard, n);
				gl.uniform1i(guardLoc("uPalette"), 1);
				gl.uniform1i(guardLoc("uPalettedClipMap"), 1);
				gl.uniform4f(guardLoc("uPaletteRect"), origin, origin, side, side);
				check(kind + "/cutout", 8, 1, () => [0, 0, 0, 0]);
				gl.uniform1i(guardLoc("uProbeOffset"), side * side);
				check(kind + "/out-of-range", 8, 1, () => [0, 0, 0, 0]);
				gl.deleteProgram(paletteProgram);
				gl.deleteProgram(guard);
				gl.deleteTexture(base);
				gl.deleteTexture(pal);
			}
		}
		const source = sources.object;

		// Four distinct indices must blend their colors, rather than blend the indices themselves.
		const blendProgram = program(
			source.slice(0, source.indexOf("void main()")) +
				"void main(){fragmentColor=sampleIndexedPaletteLinear(vec2(0.5));}",
		);
		const blendLoc = (n) => gl.getUniformLocation(blendProgram, n);
		gl.uniform1i(blendLoc("uBase"), 0);
		gl.uniform1i(blendLoc("uPalette"), 1);
		gl.uniform1i(blendLoc("uMaterialKind"), 2);
		gl.uniform4f(blendLoc("uBaseRect"), 0, 0, 2, 2);
		gl.uniform4f(blendLoc("uPaletteRect"), 0, 0, 4, 4);
		const blendPalette = new Uint8Array(4 * 4 * 4);
		for (let i = 0; i < 4; i++)
			blendPalette.set([i * 64, 0, 0, 255], (8 + i) * 4);
		texture(0, 2, 2, new Uint8Array([8, 9, 10, 11]), 1);
		texture(1, 4, 4, blendPalette, 4);
		check("palette-color-interpolation", 1, 1, () => [96, 0, 0, 255]);
		// One clipped tap contributes transparent black; it must not discard the whole fragment.
		for (let i = 8; i < 12; i++) blendPalette.set([255, 0, 0, 255], i * 4);
		texture(0, 2, 2, new Uint8Array([0, 9, 10, 11]), 1);
		texture(1, 4, 4, blendPalette, 4);
		gl.uniform1i(blendLoc("uPalettedClipMap"), 1);
		check("clip-before-interpolation", 1, 1, () => [191, 0, 0, 191]);
		results.push({ kind: "bilinear-and-clip", count: 2 });

		const wrapProgram = program(
			source.slice(0, source.indexOf("void main()")) +
				"void main(){ivec2 p=resolveIndexedCoordinate(ivec2(gl_FragCoord.xy)-ivec2(1),ivec2(7,11));fragmentColor=vec4(vec2(p)/255.0,0,1);}",
		);
		for (const repeat of [false, true]) {
			gl.uniform1i(
				gl.getUniformLocation(wrapProgram, "uWrapRepeat"),
				repeat ? 1 : 0,
			);
			check("wrapping/" + repeat, 9, 13, (i) => {
				const x = (i % 9) - 1,
					y = Math.floor(i / 9) - 1;
				return [
					repeat ? (x < 0 ? 6 : x === 7 ? 0 : x) : Math.max(0, Math.min(6, x)),
					repeat
						? y < 0
							? 10
							: y === 11
								? 0
								: y
						: Math.max(0, Math.min(10, y)),
					0,
					255,
				];
			});
		}
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			renderer: ext
				? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
				: gl.getParameter(gl.RENDERER),
			results,
			wrappingChecks: 234,
		};
	} finally {
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}
