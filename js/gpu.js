/**
 * Which graphics processor is the browser actually rendering with?
 *
 * A web page cannot pick the GPU: it can only ask for the fast one
 * (powerPreference: 'high-performance'). On laptops with two GPUs the
 * operating system often hands the browser the integrated one, and with
 * hardware acceleration turned off the browser falls back to the CPU.
 * Knowing it lets the page pick sensible defaults and tell the user.
 */

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const DISCRETE = /nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|arc a\d/i;
const INTEGRATED = /intel|iris|uhd graphics|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d* ?graphics/i;

/** @returns {{ raw: string, name: string, kind: 'discrete'|'integrated'|'software'|'other' }} */
export function describeGpu(renderer) {
  const gl = renderer.getContext();
  let raw = '';
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    raw = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    raw = '';
  }

  let kind = 'other';
  if (SOFTWARE.test(raw)) kind = 'software';
  else if (DISCRETE.test(raw)) kind = 'discrete';
  else if (INTEGRATED.test(raw)) kind = 'integrated';

  return { raw, name: kind === 'software' ? 'CPU (sem aceleração de hardware)' : cleanName(raw), kind };
}

/**
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)"
 * becomes "NVIDIA GeForce RTX 3050 Laptop GPU".
 */
function cleanName(raw) {
  let name = raw;
  if (name.startsWith('ANGLE (') && name.endsWith(')')) {
    const parts = name.slice(7, -1).split(', ');
    name = parts[1] || parts[0];
  }
  return (
    name
      .replace(/^ANGLE Metal Renderer: /, '')
      .replace(/\s*\(0x[0-9a-f]+\)/i, '')
      .replace(/\s+(Direct3D|OpenGL|Vulkan|vs_\d).*$/i, '')
      .replace(/\/PCIe.*$/i, '')
      .trim() || 'GPU desconhecida'
  );
}
