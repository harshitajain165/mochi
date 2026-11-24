// Tiny WebGL2 mesh renderer: draws one pose image as a GX×GY grid whose
// vertices can be bent, so tails swish, legs swing and spines flex
// smoothly with no seams.

const MeshGL = (() => {
  const GX = 30, GY = 16;

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) throw new Error('WebGL2 not available');

    const vs = `#version 300 es
      in vec2 a_pos; in vec2 a_uv;
      uniform vec2 u_res;
      out vec2 v_uv;
      void main() {
        vec2 c = a_pos / u_res * 2.0 - 1.0;
        gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
        v_uv = a_uv;
      }`;
    const fs = `#version 300 es
      precision mediump float;
      in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha;
      out vec4 o;
      void main() { o = texture(u_tex, v_uv) * u_alpha; }`;

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uAlpha = gl.getUniformLocation(prog, 'u_alpha');

    // static uv + index buffers
    const uvs = new Float32Array((GX + 1) * (GY + 1) * 2);
    for (let j = 0, k = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) { uvs[k++] = i / GX; uvs[k++] = j / GY; }
    const idx = new Uint16Array(GX * GY * 6);
    for (let j = 0, k = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const a = j * (GX + 1) + i, b = a + 1, c = a + GX + 1, d = c + 1;
        idx.set([a, b, c, b, d, c], k); k += 6;
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer();
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer();
    const aUv = gl.getAttribLocation(prog, 'a_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const textures = new Map();
    function texture(bitmap) {
      if (textures.has(bitmap)) return textures.get(bitmap);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.set(bitmap, t);
      return t;
    }

    const pos = new Float32Array((GX + 1) * (GY + 1) * 2);

    return {
      GX, GY,
      begin(w, h) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uRes, w, h);
      },
      // place(u, v) -> [x, y] in CSS pixels
      draw(bitmap, place, alpha = 1) {
        for (let j = 0, k = 0; j <= GY; j++) {
          for (let i = 0; i <= GX; i++) {
            const p = place(i / GX, j / GY);
            pos[k++] = p[0]; pos[k++] = p[1];
          }
        }
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture(bitmap));
        gl.uniform1f(uAlpha, alpha);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      },
    };
  }

  return { create };
})();
