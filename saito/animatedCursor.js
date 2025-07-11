
// Wait for window to load completely before initializing
window.addEventListener('load', initFluidSimulation);

function initFluidSimulation() {
    const canvas = document.getElementById('fluid');

    // Configuration object with default values
    const config = {
        SIM_RESOLUTION: 128,
        DYE_RESOLUTION: 1440,
        CAPTURE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 3.5,
        VELOCITY_DISSIPATION: 2,
        PRESSURE: 0.1,
        PRESSURE_ITERATIONS: 20,
        CURL: 10,
        SPLAT_RADIUS: 0.5,
        SPLAT_FORCE: 6000,
        SHADING: true,
        COLOR_UPDATE_SPEED: 10,
        PAUSED: false,
        BACK_COLOR: { r: 0, g: 0, b: 0 },
        TRANSPARENT: true,
    };






    // Pointer prototype for tracking input
    function Pointer() {
        this.id = -1;
        this.texcoordX = 0;
        this.texcoordY = 0;
        this.prevTexcoordX = 0;
        this.prevTexcoordY = 0;
        this.deltaX = 0;
        this.deltaY = 0;
        this.down = false;
        this.moved = false;
        this.color = [30, 0, 300];
    }

    const pointers = [new Pointer()];

    // Get WebGL context
    const { gl, ext } = getWebGLContext(canvas);

    if (!ext.supportLinearFiltering) {
        config.DYE_RESOLUTION = 512;
        config.SHADING = false;
    }

    /**
     * Gets WebGL context and extensions
     * @param {HTMLCanvasElement} canvas 
     * @returns {Object} Context and extensions
     */
    function getWebGLContext(canvas) {
        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            preserveDrawingBuffer: false,
            powerPreference: 'low-power'
        };

        let gl = canvas.getContext('webgl2', params);
        const isWebGL2 = !!gl;
        if (!isWebGL2) {
            gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
        }

        let halfFloat;
        let supportLinearFiltering;
        if (isWebGL2) {
            gl.getExtension('EXT_color_buffer_float');
            supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
        } else {
            halfFloat = gl.getExtension('OES_texture_half_float');
            supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
        }

        gl.clearColor(0.0, 0.0, 0.0, 1.0);

        const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
        let formatRGBA;
        let formatRG;
        let formatR;

        if (isWebGL2) {
            formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
            formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
            formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
        } else {
            formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        }

        return {
            gl,
            ext: {
                formatRGBA,
                formatRG,
                formatR,
                halfFloatTexType,
                supportLinearFiltering
            }
        };
    }

    /**
     * Gets supported texture format
     * @param {WebGLRenderingContext} gl 
     * @param {number} internalFormat 
     * @param {number} format 
     * @param {number} type 
     * @returns {Object|null} Supported format or null
     */
    function getSupportedFormat(gl, internalFormat, format, type) {
        if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
            switch (internalFormat) {
                case gl.R16F:
                    return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
                case gl.RG16F:
                    return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
                default:
                    return null;
            }
        }

        return {
            internalFormat,
            format
        };
    }

    /**
     * Checks if render texture format is supported
     * @param {WebGLRenderingContext} gl 
     * @param {number} internalFormat 
     * @param {number} format 
     * @param {number} type 
     * @returns {boolean} True if supported
     */
    function supportRenderTextureFormat(gl, internalFormat, format, type) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        return status === gl.FRAMEBUFFER_COMPLETE;
    }

    /**
     * Material class for shader programs
     */
    class Material {
        /**
         * @param {WebGLShader} vertexShader 
         * @param {string} fragmentShaderSource 
         */
        constructor(vertexShader, fragmentShaderSource) {
            this.vertexShader = vertexShader;
            this.fragmentShaderSource = fragmentShaderSource;
            this.programs = [];
            this.activeProgram = null;
            this.uniforms = [];
        }

        /**
         * Sets shader keywords
         * @param {string[]} keywords 
         */
        setKeywords(keywords) {
            let hash = 0;
            for (let i = 0; i < keywords.length; i++) {
                hash += hashCode(keywords[i]);
            }

            let program = this.programs[hash];
            if (program == null) {
                const fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
                program = createProgram(this.vertexShader, fragmentShader);
                this.programs[hash] = program;
            }

            if (program === this.activeProgram) return;

            this.uniforms = getUniforms(program);
            this.activeProgram = program;
        }

        bind() {
            gl.useProgram(this.activeProgram);
        }
    }

    /**
     * Program class for shader programs
     */
    class Program {
        /**
         * @param {WebGLShader} vertexShader 
         * @param {WebGLShader} fragmentShader 
         */
        constructor(vertexShader, fragmentShader) {
            this.uniforms = {};
            this.program = createProgram(vertexShader, fragmentShader);
            this.uniforms = getUniforms(this.program);
        }

        bind() {
            gl.useProgram(this.program);
        }
    }

    /**
     * Creates a shader program
     * @param {WebGLShader} vertexShader 
     * @param {WebGLShader} fragmentShader 
     * @returns {WebGLProgram} 
     */
    function createProgram(vertexShader, fragmentShader) {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.trace(gl.getProgramInfoLog(program));
        }

        return program;
    }

    /**
     * Gets uniforms from program
     * @param {WebGLProgram} program 
     * @returns {Object} Uniforms
     */
    function getUniforms(program) {
        const uniforms = [];
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }
        return uniforms;
    }

    /**
     * Compiles a shader
     * @param {number} type 
     * @param {string} source 
     * @param {string[]} keywords 
     * @returns {WebGLShader} 
     */
    function compileShader(type, source, keywords) {
        source = addKeywords(source, keywords);

        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.trace(gl.getShaderInfoLog(shader));
        }

        return shader;
    }

    /**
     * Adds keywords to shader source
     * @param {string} source 
     * @param {string[]} keywords 
     * @returns {string} 
     */
    function addKeywords(source, keywords) {
        if (keywords == null) return source;
        let keywordsString = '';
        keywords.forEach(keyword => {
            keywordsString += '#define ' + keyword + '\n';
        });
        return keywordsString + source;
    }

    // Shader compilation
    const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
                    precision highp float;
                    attribute vec2 aPosition;
                    varying vec2 vUv;
                    varying vec2 vL;
                    varying vec2 vR;
                    varying vec2 vT;
                    varying vec2 vB;
                    uniform vec2 texelSize;
                    void main() {
                        vUv = aPosition * 0.5 + 0.5;
                        vL = vUv - vec2(texelSize.x, 0.0);
                        vR = vUv + vec2(texelSize.x, 0.0);
                        vT = vUv + vec2(0.0, texelSize.y);
                        vB = vUv - vec2(0.0, texelSize.y);
                        gl_Position = vec4(aPosition, 0.0, 1.0);
                    }
                `);

    const blurVertexShader = compileShader(gl.VERTEX_SHADER, `
                    precision highp float;
                    attribute vec2 aPosition;
                    varying vec2 vUv;
                    varying vec2 vL;
                    varying vec2 vR;
                    uniform vec2 texelSize;
                    void main() {
                        vUv = aPosition * 0.5 + 0.5;
                        float offset = 1.33333333;
                        vL = vUv - texelSize * offset;
                        vR = vUv + texelSize * offset;
                        gl_Position = vec4(aPosition, 0.0, 1.0);
                    }
                `);

    const blurShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying vec2 vUv;
                    varying vec2 vL;
                    varying vec2 vR;
                    uniform sampler2D uTexture;
                    void main() {
                        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
                        sum += texture2D(uTexture, vL) * 0.35294117;
                        sum += texture2D(uTexture, vR) * 0.35294117;
                        gl_FragColor = sum;
                    }
                `);

    const copyShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying highp vec2 vUv;
                    uniform sampler2D uTexture;
                    void main() {
                        gl_FragColor = texture2D(uTexture, vUv);
                    }
                `);

    const clearShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying highp vec2 vUv;
                    uniform sampler2D uTexture;
                    uniform float value;
                    void main() {
                        gl_FragColor = value * texture2D(uTexture, vUv);
                    }
                `);

    const colorShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    uniform vec4 color;
                    void main() {
                        gl_FragColor = color;
                    }
                `);

    const displayShaderSource = `
                    precision highp float;
                    precision highp sampler2D;
                    varying vec2 vUv;
                    varying vec2 vL;
                    varying vec2 vR;
                    varying vec2 vT;
                    varying vec2 vB;
                    uniform sampler2D uTexture;
                    uniform sampler2D uDithering;
                    uniform vec2 ditherScale;
                    uniform vec2 texelSize;
                    vec3 linearToGamma(vec3 color) {
                        color = max(color, vec3(0));
                        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
                    }
                    void main() {
                        vec3 c = texture2D(uTexture, vUv).rgb;
                        #ifdef SHADING
                            vec3 lc = texture2D(uTexture, vL).rgb;
                            vec3 rc = texture2D(uTexture, vR).rgb;
                            vec3 tc = texture2D(uTexture, vT).rgb;
                            vec3 bc = texture2D(uTexture, vB).rgb;
                            float dx = length(rc) - length(lc);
                            float dy = length(tc) - length(bc);
                            vec3 n = normalize(vec3(dx, dy, length(texelSize)));
                            vec3 l = vec3(0.0, 0.0, 1.0);
                            float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
                            c *= diffuse;
                        #endif
                        float a = max(c.r, max(c.g, c.b));
                        gl_FragColor = vec4(c, a);
                    }
                `;

    const splatShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision highp float;
                    precision highp sampler2D;
                    varying vec2 vUv;
                    uniform sampler2D uTarget;
                    uniform float aspectRatio;
                    uniform vec3 color;
                    uniform vec2 point;
                    uniform float radius;
                    void main() {
                        vec2 p = vUv - point.xy;
                        p.x *= aspectRatio;
                        vec3 splat = exp(-dot(p, p) / radius) * color;
                        vec3 base = texture2D(uTarget, vUv).xyz;
                        gl_FragColor = vec4(base + splat, 1.0);
                    }
                `);

    const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision highp float;
                    precision highp sampler2D;
                    varying vec2 vUv;
                    uniform sampler2D uVelocity;
                    uniform sampler2D uSource;
                    uniform vec2 texelSize;
                    uniform vec2 dyeTexelSize;
                    uniform float dt;
                    uniform float dissipation;
                    vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
                        vec2 st = uv / tsize - 0.5;
                        vec2 iuv = floor(st);
                        vec2 fuv = fract(st);
                        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
                        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
                        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
                        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
                        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
                    }
                    void main() {
                        #ifdef MANUAL_FILTERING
                            vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
                            vec4 result = bilerp(uSource, coord, dyeTexelSize);
                        #else
                            vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                            vec4 result = texture2D(uSource, coord);
                        #endif
                        float decay = 1.0 + dissipation * dt;
                        gl_FragColor = result / decay;
                    }
                `, ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']);

    const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying highp vec2 vUv;
                    varying highp vec2 vL;
                    varying highp vec2 vR;
                    varying highp vec2 vT;
                    varying highp vec2 vB;
                    uniform sampler2D uVelocity;
                    void main() {
                        float L = texture2D(uVelocity, vL).x;
                        float R = texture2D(uVelocity, vR).x;
                        float T = texture2D(uVelocity, vT).y;
                        float B = texture2D(uVelocity, vB).y;
                        vec2 C = texture2D(uVelocity, vUv).xy;
                        if (vL.x < 0.0) { L = -C.x; }
                        if (vR.x > 1.0) { R = -C.x; }
                        if (vT.y > 1.0) { T = -C.y; }
                        if (vB.y < 0.0) { B = -C.y; }
                        float div = 0.5 * (R - L + T - B);
                        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
                    }
                `);

    const curlShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying highp vec2 vUv;
                    varying highp vec2 vL;
                    varying highp vec2 vR;
                    varying highp vec2 vT;
                    varying highp vec2 vB;
                    uniform sampler2D uVelocity;
                    void main() {
                        float L = texture2D(uVelocity, vL).y;
                        float R = texture2D(uVelocity, vR).y;
                        float T = texture2D(uVelocity, vT).x;
                        float B = texture2D(uVelocity, vB).x;
                        float vorticity = R - L - T + B;
                        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
                    }
                `);

    const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision highp float;
                    precision highp sampler2D;
                    varying vec2 vUv;
                    varying vec2 vL;
                    varying vec2 vR;
                    varying vec2 vT;
                    varying vec2 vB;
                    uniform sampler2D uVelocity;
                    uniform sampler2D uCurl;
                    uniform float curl;
                    uniform float dt;
                    void main() {
                        float L = texture2D(uCurl, vL).x;
                        float R = texture2D(uCurl, vR).x;
                        float T = texture2D(uCurl, vT).x;
                        float B = texture2D(uCurl, vB).x;
                        float C = texture2D(uCurl, vUv).x;
                        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                        force /= length(force) + 0.0001;
                        force *= curl * C;
                        force.y *= -1.0;
                        vec2 velocity = texture2D(uVelocity, vUv).xy;
                        velocity += force * dt;
                        velocity = min(max(velocity, -1000.0), 1000.0);
                        gl_FragColor = vec4(velocity, 0.0, 1.0);
                    }
                `);

    const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying highp vec2 vUv;
                    varying highp vec2 vL;
                    varying highp vec2 vR;
                    varying highp vec2 vT;
                    varying highp vec2 vB;
                    uniform sampler2D uPressure;
                    uniform sampler2D uDivergence;
                    void main() {
                        float L = texture2D(uPressure, vL).x;
                        float R = texture2D(uPressure, vR).x;
                        float T = texture2D(uPressure, vT).x;
                        float B = texture2D(uPressure, vB).x;
                        float C = texture2D(uPressure, vUv).x;
                        float divergence = texture2D(uDivergence, vUv).x;
                        float pressure = (L + R + B + T - divergence) * 0.25;
                        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
                    }
                `);

    const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
                    precision mediump float;
                    precision mediump sampler2D;
                    varying highp vec2 vUv;
                    varying highp vec2 vL;
                    varying highp vec2 vR;
                    varying highp vec2 vT;
                    varying highp vec2 vB;
                    uniform sampler2D uPressure;
                    uniform sampler2D uVelocity;
                    void main() {
                        float L = texture2D(uPressure, vL).x;
                        float R = texture2D(uPressure, vR).x;
                        float T = texture2D(uPressure, vT).x;
                        float B = texture2D(uPressure, vB).x;
                        vec2 velocity = texture2D(uVelocity, vUv).xy;
                        velocity.xy -= vec2(R - L, T - B);
                        gl_FragColor = vec4(velocity, 0.0, 1.0);
                    }
                `);

    // Blit function for rendering to framebuffer
    const blit = (() => {
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        return (target, clear = false) => {
            if (target == null) {
                gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            } else {
                gl.viewport(0, 0, target.width, target.height);
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
            }
            if (clear) {
                gl.clearColor(0.0, 0.0, 0.0, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        };
    })();

    // Framebuffers
    let dye;
    let velocity;
    let divergence;
    let curl;
    let pressure;
    let ditheringTexture = createTextureAsync('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==');

    // Shader programs
    const blurProgram = new Program(blurVertexShader, blurShader);
    const copyProgram = new Program(baseVertexShader, copyShader);
    const clearProgram = new Program(baseVertexShader, clearShader);
    const colorProgram = new Program(baseVertexShader, colorShader);
    const splatProgram = new Program(baseVertexShader, splatShader);
    const advectionProgram = new Program(baseVertexShader, advectionShader);
    const divergenceProgram = new Program(baseVertexShader, divergenceShader);
    const curlProgram = new Program(baseVertexShader, curlShader);
    const vorticityProgram = new Program(baseVertexShader, vorticityShader);
    const pressureProgram = new Program(baseVertexShader, pressureShader);
    const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

    const displayMaterial = new Material(baseVertexShader, displayShaderSource);

    /**
     * Initializes framebuffers
     */
    function initFramebuffers() {
        const simRes = getResolution(config.SIM_RESOLUTION);
        const dyeRes = getResolution(config.DYE_RESOLUTION);

        const texType = ext.halfFloatTexType;
        const rgba = ext.formatRGBA;
        const rg = ext.formatRG;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        gl.disable(gl.BLEND);

        if (dye == null) {
            dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        } else {
            dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        }

        if (velocity == null) {
            velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        } else {
            velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        }

        divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    }

    /**
     * Creates a framebuffer object
     * @param {number} w Width
     * @param {number} h Height
     * @param {number} internalFormat 
     * @param {number} format 
     * @param {number} type 
     * @param {number} param 
     * @returns {Object} FBO
     */
    function createFBO(w, h, internalFormat, format, type, param) {
        gl.activeTexture(gl.TEXTURE0);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const texelSizeX = 1.0 / w;
        const texelSizeY = 1.0 / h;

        return {
            texture,
            fbo,
            width: w,
            height: h,
            texelSizeX,
            texelSizeY,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    /**
     * Creates a double framebuffer object
     * @param {number} w Width
     * @param {number} h Height
     * @param {number} internalFormat 
     * @param {number} format 
     * @param {number} type 
     * @param {number} param 
     * @returns {Object} Double FBO
     */
    function createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = createFBO(w, h, internalFormat, format, type, param);

        return {
            width: w,
            height: h,
            texelSizeX: fbo1.texelSizeX,
            texelSizeY: fbo1.texelSizeY,
            get read() {
                return fbo1;
            },
            set read(value) {
                fbo1 = value;
            },
            get write() {
                return fbo2;
            },
            set write(value) {
                fbo2 = value;
            },
            swap() {
                const temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            }
        };
    }

    /**
     * Resizes a framebuffer object
     * @param {Object} target FBO to resize
     * @param {number} w Width
     * @param {number} h Height
     * @param {number} internalFormat 
     * @param {number} format 
     * @param {number} type 
     * @param {number} param 
     * @returns {Object} Resized FBO
     */
    function resizeFBO(target, w, h, internalFormat, format, type, param) {
        const newFBO = createFBO(w, h, internalFormat, format, type, param);
        copyProgram.bind();
        gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
        blit(newFBO);
        return newFBO;
    }

    /**
     * Resizes a double framebuffer object
     * @param {Object} target Double FBO to resize
     * @param {number} w Width
     * @param {number} h Height
     * @param {number} internalFormat 
     * @param {number} format 
     * @param {number} type 
     * @param {number} param 
     * @returns {Object} Resized double FBO
     */
    function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
        if (target.width === w && target.height === h) {
            return target;
        }
        target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
        target.write = createFBO(w, h, internalFormat, format, type, param);
        target.width = w;
        target.height = h;
        target.texelSizeX = 1.0 / w;
        target.texelSizeY = 1.0 / h;
        return target;
    }

    /**
     * Creates a texture asynchronously
     * @param {string} url Texture URL
     * @returns {Object} Texture object
     */
    function createTextureAsync(url) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

        const obj = {
            texture,
            width: 1,
            height: 1,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };

        const image = new Image();
        image.onload = () => {
            obj.width = image.width;
            obj.height = image.height;
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
        };
        image.src = url;

        return obj;
    }

    /**
     * Updates shader keywords
     */
    function updateKeywords() {
        const displayKeywords = [];
        if (config.SHADING) displayKeywords.push("SHADING");
        displayMaterial.setKeywords(displayKeywords);
    }

    // Initialize
    updateKeywords();
    initFramebuffers();

    let lastUpdateTime = Date.now();
    let colorUpdateTimer = 0.0;

    /**
     * Main update loop
     */
    function update() {
        const dt = calcDeltaTime();
        if (resizeCanvas()) {
            initFramebuffers();
        }
        updateColors(dt);
        applyInputs();
        if (!config.PAUSED) {
            step(dt);
        }
        render(null);
        requestAnimationFrame(update);
    }

    /**
     * Calculates delta time
     * @returns {number} Delta time in seconds
     */
    function calcDeltaTime() {
        const now = Date.now();
        let dt = (now - lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666);
        lastUpdateTime = now;
        return dt;
    }

    /**
     * Resizes canvas if needed
     * @returns {boolean} True if canvas was resized
     */
    function resizeCanvas() {
        const width = scaleByPixelRatio(canvas.clientWidth);
        const height = scaleByPixelRatio(canvas.clientHeight);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            return true;
        }
        return false;
    }

    /**
     * Updates colors
     * @param {number} dt Delta time
     */
    function updateColors(dt) {
        colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
        if (colorUpdateTimer >= 1) {
            colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
            pointers.forEach(p => {
                p.color = generateColor();
            });
        }
    }

    /**
     * Applies input splats
     */
    function applyInputs() {
        pointers.forEach(p => {
            if (p.moved) {
                p.moved = false;
                splatPointer(p);
            }
        });
    }

    /**
     * Simulation step
     * @param {number} dt Delta time
     */
    function step(dt) {
        gl.disable(gl.BLEND);

        // Curl
        curlProgram.bind();
        gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(curl);

        // Vorticity
        vorticityProgram.bind();
        gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
        gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
        gl.uniform1f(vorticityProgram.uniforms.dt, dt);
        blit(velocity.write);
        velocity.swap();

        // Divergence
        divergenceProgram.bind();
        gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(divergence);

        // Clear pressure
        clearProgram.bind();
        gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
        gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
        blit(pressure.write);
        pressure.swap();

        // Pressure solve
        pressureProgram.bind();
        gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
        for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
            blit(pressure.write);
            pressure.swap();
        }

        // Gradient subtract
        gradienSubtractProgram.bind();
        gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
        gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
        blit(velocity.write);
        velocity.swap();

        // Advection
        advectionProgram.bind();
        gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!ext.supportLinearFiltering) {
            gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
        }
        const velocityId = velocity.read.attach(0);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
        gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
        gl.uniform1f(advectionProgram.uniforms.dt, dt);
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
        blit(velocity.write);
        velocity.swap();

        if (!ext.supportLinearFiltering) {
            gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
        }
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
        blit(dye.write);
        dye.swap();
    }

    /**
     * Renders to target
     * @param {Object|null} target Framebuffer or null for screen
     */
    function render(target) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
        drawDisplay(target);
    }

    /**
     * Draws display
     * @param {Object|null} target Framebuffer or null for screen
     */
    function drawDisplay(target) {
        const width = target == null ? gl.drawingBufferWidth : target.width;
        const height = target == null ? gl.drawingBufferHeight : target.height;

        displayMaterial.bind();
        if (config.SHADING) {
            gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
        }
        gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
        blit(target);
    }

    /**
     * Splats a pointer
     * @param {Object} pointer Pointer object
     */
    function splatPointer(pointer) {
        const dx = pointer.deltaX * config.SPLAT_FORCE;
        const dy = pointer.deltaY * config.SPLAT_FORCE;
        splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }

    /**
     * Creates a click splat
     * @param {Object} pointer Pointer object
     */
    function clickSplat(pointer) {
        const color = generateColor();
        color.r *= 10.0;
        color.g *= 10.0;
        color.b *= 10.0;
        const dx = 10 * (Math.random() - 0.5);
        const dy = 30 * (Math.random() - 0.5);
        splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
    }

    /**
     * Creates a splat
     * @param {number} x X coordinate
     * @param {number} y Y coordinate
     * @param {number} dx X velocity
     * @param {number} dy Y velocity
     * @param {Object} color Color object
     */
    function splat(x, y, dx, dy, color) {
        splatProgram.bind();
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
        gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(splatProgram.uniforms.point, x, y);
        gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
        blit(velocity.write);
        velocity.swap();

        gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
        gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
        blit(dye.write);
        dye.swap();
    }

    /**
     * Corrects radius based on aspect ratio
     * @param {number} radius 
     * @returns {number} Corrected radius
     */
    function correctRadius(radius) {
        const aspectRatio = canvas.width / canvas.height;
        if (aspectRatio > 1) {
            radius *= aspectRatio;
        }
        return radius;
    }

    // Event listeners
    function handleMouseDown(e) {
        const pointer = pointers[0];
        const posX = scaleByPixelRatio(e.clientX);
        const posY = scaleByPixelRatio(e.clientY);
        updatePointerDownData(pointer, -1, posX, posY);
        clickSplat(pointer);
    }

    function handleMouseMove(e) {
        const pointer = pointers[0];
        const posX = scaleByPixelRatio(e.clientX);
        const posY = scaleByPixelRatio(e.clientY);
        const color = pointer.color;
        updatePointerMoveData(pointer, posX, posY, color);
    }

    function handleTouchStart(e) {
        e.preventDefault();
        const touches = e.targetTouches;
        for (let i = 0; i < touches.length; i++) {
            let pointer = pointers[i];
            if (!pointer) {
                pointer = new Pointer();
                pointers[i] = pointer;
            }
            const posX = scaleByPixelRatio(touches[i].clientX);
            const posY = scaleByPixelRatio(touches[i].clientY);
            updatePointerDownData(pointer, touches[i].identifier, posX, posY);

            // Create a splat on touch start
            splatPointer(pointer);
        }
    }

    function handleTouchMove(e) {
        e.preventDefault();
        const touches = e.targetTouches;
        for (let i = 0; i < touches.length; i++) {
            const touch = touches[i];
            let pointer = pointers[i];

            // Find pointer by identifier if not in order
            if (!pointer) {
                pointer = pointers.find(p => p.id === touch.identifier) || new Pointer();
                pointers[i] = pointer;
            }

            if (pointer) {
                const posX = scaleByPixelRatio(touch.clientX);
                const posY = scaleByPixelRatio(touch.clientY);
                updatePointerMoveData(pointer, posX, posY, pointer.color);
            }
        }
    }

    function handleTouchEnd(e) {
        e.preventDefault();
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) {
            const pointer = pointers.find(p => p.id === touches[i].identifier);
            if (pointer) {
                updatePointerUpData(pointer);
            }
        }
    }

        // Add mobile-optimized event listeners
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    // Add mouse support for devices that support both (like tablets)
    canvas.addEventListener('mousedown', (e) => {
        const pointer = pointers[0];
        const posX = scaleByPixelRatio(e.clientX);
        const posY = scaleByPixelRatio(e.clientY);
        updatePointerDownData(pointer, -1, posX, posY);
        splatPointer(pointer);
    });

     canvas.addEventListener('mousemove', (e) => {
        if (e.buttons === 1) { // Only if left button is pressed
            const pointer = pointers[0];
            const posX = scaleByPixelRatio(e.clientX);
            const posY = scaleByPixelRatio(e.clientY);
            updatePointerMoveData(pointer, posX, posY, pointer.color);
        }
    });

    canvas.addEventListener('mouseup', () => {
        const pointer = pointers[0];
        updatePointerUpData(pointer);
    });

    // Handle device rotation and resize
    window.addEventListener('resize', () => {
        resizeCanvas();
        initFramebuffers();
    });

    // Performance optimization for mobile
    let isHidden = false;
    document.addEventListener('visibilitychange', () => {
        isHidden = document.hidden;
    });

    

    // Add event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    // Cleanup function for when the page is refreshed
    window.addEventListener('beforeunload', () => {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
    });

    /**
     * Updates pointer down data
     * @param {Object} pointer Pointer object
     * @param {number} id Pointer ID
     * @param {number} posX X position
     * @param {number} posY Y position
     */
    function updatePointerDownData(pointer, id, posX, posY) {
        pointer.id = id;
        pointer.down = true;
        pointer.moved = false;
        pointer.texcoordX = posX / canvas.width;
        pointer.texcoordY = 1.0 - posY / canvas.height;
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.deltaX = 0;
        pointer.deltaY = 0;
        pointer.color = generateColor();
    }

    /**
     * Updates pointer move data
     * @param {Object} pointer Pointer object
     * @param {number} posX X position
     * @param {number} posY Y position
     * @param {Object} color Color object
     */
    function updatePointerMoveData(pointer, posX, posY, color) {
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = posX / canvas.width;
        pointer.texcoordY = 1.0 - posY / canvas.height;
        pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
        pointer.color = color;
    }

    /**
     * Updates pointer up data
     * @param {Object} pointer Pointer object
     */
    function updatePointerUpData(pointer) {
        pointer.down = false;
    }

    /**
     * Corrects delta X based on aspect ratio
     * @param {number} delta 
     * @returns {number} Corrected delta
     */
    function correctDeltaX(delta) {
        const aspectRatio = canvas.width / canvas.height;
        if (aspectRatio < 1) delta *= aspectRatio;
        return delta;
    }

    /**
     * Corrects delta Y based on aspect ratio
     * @param {number} delta 
     * @returns {number} Corrected delta
     */
    function correctDeltaY(delta) {
        const aspectRatio = canvas.width / canvas.height;
        if (aspectRatio > 1) delta /= aspectRatio;
        return delta;
    }

    /**
     * Generates a random color
     * @returns {Object} Color object with r, g, b properties
     */
    function generateColor() {
        const c = HSVtoRGB(Math.random(), 1.0, 1.0);
        c.r *= 0.15;
        c.g *= 0.15;
        c.b *= 0.15;
        return c;
    }

    /**
     * Converts HSV to RGB
     * @param {number} h Hue
     * @param {number} s Saturation
     * @param {number} v Value
     * @returns {Object} Color object with r, g, b properties
     */
    function HSVtoRGB(h, s, v) {
        let r, g, b, i, f, p, q, t;
        i = Math.floor(h * 6);
        f = h * 6 - i;
        p = v * (1 - s);
        q = v * (1 - f * s);
        t = v * (1 - (1 - f) * s);

        switch (i % 6) {
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }

        return { r, g, b };
    }

    /**
     * Wraps a value between min and max
     * @param {number} value 
     * @param {number} min 
     * @param {number} max 
     * @returns {number} Wrapped value
     */
    function wrap(value, min, max) {
        const range = max - min;
        if (range === 0) return min;
        return (value - min) % range + min;
    }

    /**
     * Gets resolution based on aspect ratio
     * @param {number} resolution 
     * @returns {Object} Width and height
     */
    function getResolution(resolution) {
        let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
        if (aspectRatio < 1) {
            aspectRatio = 1.0 / aspectRatio;
        }

        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);

        if (gl.drawingBufferWidth > gl.drawingBufferHeight) {
            return { width: max, height: min };
        } else {
            return { width: min, height: max };
        }
    }

    /**
     * Scales input by pixel ratio
     * @param {number} input 
     * @returns {number} Scaled value
     */
    function scaleByPixelRatio(input) {
        const pixelRatio = window.devicePixelRatio || 1;
        return Math.floor(input * pixelRatio);
    }

    /**
     * Generates hash code for string
     * @param {string} s 
     * @returns {number} Hash code
     */
    function hashCode(s) {
        if (s.length === 0) return 0;
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = (hash << 5) - hash + s.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }

    // Start the simulation
    update();
}
