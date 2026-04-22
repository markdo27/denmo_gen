/**
 * gcodeEmitter.js
 * Formats a 3D toolpath into G-code strings.
 */

/**
 * Calculates the Euclidean distance between two 3D points.
 */
function dist3D(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Formats the toolpath into G-code.
 *
 * @param {object[]} path     - Array of {x, y, z} toolpath points
 * @param {object}   settings - Print settings
 * @returns {string}          - Formatted G-code
 */
export function emitGcode(path, settings = {}) {
  const {
    nozzleSize    = 0.4,
    layerHeight   = 0.2,
    extrusionMult = 1.0,
    filamentDiam  = 1.75,
    feedrate      = 3000,
    travelFeedrate= 6000,
    bedTemp       = 60,
    hotendTemp    = 210,
    bedX          = 220,
    bedY          = 220,
  } = settings;

  // Calculate extrusion coefficient
  // Volume of segment = distance * nozzleSize * layerHeight
  // Volume of filament = E * Math.PI * (filamentDiam/2)^2
  // E = distance * (nozzleSize * layerHeight) / (Math.PI * (filamentDiam/2)^2)
  const filamentArea = Math.PI * Math.pow(filamentDiam / 2, 2);
  const extrusionCoeff = (nozzleSize * layerHeight) / filamentArea * extrusionMult;

  const centerX = bedX / 2;
  const centerY = bedY / 2;

  let gcode = ``;
  gcode += `; RIBBED LAMP STUDIO - Procedural G-code\n`;
  gcode += `; Generated via WebAssembly/JS Kernel\n`;
  gcode += `; Nozzle: ${nozzleSize}mm | Layer: ${layerHeight}mm\n\n`;

  // Start G-code
  gcode += `M140 S${bedTemp} ; Set bed temp\n`;
  gcode += `M104 S${hotendTemp} ; Set hotend temp\n`;
  gcode += `G28 ; Home all axes\n`;
  gcode += `M190 S${bedTemp} ; Wait for bed temp\n`;
  gcode += `M109 S${hotendTemp} ; Wait for hotend temp\n`;
  gcode += `G90 ; Absolute positioning\n`;
  gcode += `M82 ; Absolute extrusion\n`;
  gcode += `G92 E0 ; Reset extruder\n\n`;

  if (path.length === 0) return gcode;

  let currentE = 0;
  let lastPt = null;

  // Move to start point
  const startPt = path[0];
  gcode += `G0 F${travelFeedrate} X${(startPt.x + centerX).toFixed(3)} Y${(startPt.y + centerY).toFixed(3)} Z${startPt.z.toFixed(3)}\n`;
  gcode += `G1 F${feedrate}\n`;
  lastPt = startPt;

  // Extrude path
  for (let i = 1; i < path.length; i++) {
    const pt = path[i];
    const dist = dist3D(lastPt, pt);
    currentE += dist * extrusionCoeff;
    
    gcode += `G1 X${(pt.x + centerX).toFixed(3)} Y${(pt.y + centerY).toFixed(3)} Z${pt.z.toFixed(3)} E${currentE.toFixed(5)}\n`;
    lastPt = pt;
  }

  // End G-code
  gcode += `\n; End Print\n`;
  gcode += `G91 ; Relative positioning\n`;
  gcode += `G1 E-2 F2700 ; Retract\n`;
  gcode += `G1 Z10 F3000 ; Lift Z\n`;
  gcode += `G90 ; Absolute positioning\n`;
  gcode += `G1 X0 Y${bedY} F${travelFeedrate} ; Present print\n`;
  gcode += `M106 S0 ; Turn off fan\n`;
  gcode += `M104 S0 ; Turn off hotend\n`;
  gcode += `M140 S0 ; Turn off bed\n`;
  gcode += `M84 X Y E ; Disable motors\n`;

  return gcode;
}
