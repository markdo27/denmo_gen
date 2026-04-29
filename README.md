# DENMO BUILDER by Line Collective

A browser-based 3D parametric lamp design suite with G-code editing and STL-to-lamp conversion tools. Built with React, Three.js, and Vite.

## Features

### Parametric Lamp Generator (`#/`)
- **Profile shapes**: vase, hourglass, teardrop, pagoda, column, cone, sphere, SuperFormula, spherical harmonic, super-ellipsoid, or custom uploaded profiles
- **Cross sections**: circle, square, hexagon, triangle, star, gear
- **Surface modifiers**: ribs, pleats, diamond patterns, bamboo nodes, vertical ripples, twist, noise, Voronoi tessellation, reaction-diffusion patterns
- **FFD (Free-Form Deformation)**: Bernstein polynomial lattice sculpting with up to 8 control rings
- **Loop subdivision**: smooth surface refinement (up to 2 levels)
- **Lighter hole**: built-in BIC lighter cavity with beveled annular cap
- **Real-time overhang analysis**: detects critical angles and bed overflow with fix suggestions
- **G-code spiral preview**: color-coded toolpath visualization with non-planar slope support
- **Export**: STL with self-intersection and overhang validation

### Lamp-ifier (`#/lampifier`)
- Import any STL/OBJ 3D model and convert it into a functional lamp shade
- **E27 hardware cuts**: automatic boolean subtraction for E27 socket (40mm) and cord channel (8mm)
- **Retopology**: voxel remesh via marching cubes to fix broken AI-generated geometry
- **Fast hollowing**: dual-mesh merge technique for slicer-compatible hollow shells
- Physical height scaling (50–500mm)

### G-Code Editor (`#/gcode-editor`)
- Load and visualize G-code files (`.gcode`, `.3mf`, `.ufp`, `.zip`)
- **3D path visualization**: color-coded by feature type (outer wall, inner wall, infill, support, bridge, etc.)
- **Layer scrubber**: step through layers with real-time Z height display
- **Selection tools**: brush select, pattern select (every Nth, height band, feature type), shift-add
- **Transform tools**: move selected points along X/Y/Z axes
- **Operations**: redistribute points evenly, Laplacian smoothing
- **Undo history**: up to 50 steps
- **Export**: modified G-code with all edits preserved

## Tech Stack

- **React 19** — UI framework
- **Three.js / React Three Fiber** — 3D rendering
- **Drei** — R3F helpers (OrbitControls, shadows, grid, environment)
- **Leva** — parameter control panel
- **three-csg-ts** — CSG boolean operations for E27 cuts
- **three-stdlib** — STL/OBJ export and import
- **fflate** — ZIP/3MF archive extraction
- **lucide-react** — icon library
- **Vite** — build tool and dev server

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

## Navigation

| Route | Tool |
|-------|------|
| `#/` | Parametric Lamp Generator |
| `#/lampifier` | STL/OBJ → Lamp Converter |
| `#/gcode-editor` | G-Code Path Editor |

## Algorithms

- **Loop subdivision** — surface smoothing with cap/wall separation
- **Voronoi tessellation** — web worker-based cell computation
- **Reaction-diffusion** — Gray-Scott pattern generation on cylindrical surfaces
- **Free-Form Deformation** — cubic Bernstein polynomial blending
- **SuperFormula / Spherical Harmonics** — mathematical profile generation
- **Voxel retopology** — marching cubes uniform remeshing
- **Overhang analysis** — per-layer angle detection with bed-fit validation

## License

Private — all rights reserved.
