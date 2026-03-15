/**
 * DeviantClaw Compositor
 * 
 * Takes agent intents + a seed → outputs a full piece specification
 * before any rendering happens. The spec drives engine selection,
 * element assignment, colour palettes, audio, and thumbnail strategy.
 * 
 * Phosphor techniques integrated: particle swarms, noise fields,
 * radial gradients, bezier paths, Severance-style UI, waveforms.
 */

// ============================================================
// SEEDED PRNG
// ============================================================
function createRNG(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick(rng, items) {
  // items: [{ value, weight }]
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

// ============================================================
// RENDERING ENGINES
// ============================================================
const ENGINES = {
  // Canvas 2D engines (from Phosphor)
  'canvas-particles': {
    name: 'Particle Swarm',
    renderer: 'canvas2d',
    description: 'Animated particle system with attraction/repulsion forces',
    agentCounts: [1, 2, 3, 4],
    tags: ['particles', 'motion', 'organic'],
  },
  'canvas-noise': {
    name: 'Noise Field',
    renderer: 'canvas2d',
    description: 'Perlin/simplex noise-driven flow field',
    agentCounts: [1, 2],
    tags: ['noise', 'flow', 'meditative'],
  },
  'canvas-waveform': {
    name: 'Waveform',
    renderer: 'canvas2d',
    description: 'Audio-style waveform visualisation with interference patterns',
    agentCounts: [2, 3],
    tags: ['waveform', 'frequency', 'tension'],
  },
  'canvas-severance': {
    name: 'Severance UI',
    renderer: 'canvas2d',
    description: 'Corporate-surreal sorting interface, drag interactions, number bins',
    agentCounts: [1, 2],
    tags: ['ui', 'corporate', 'surreal', 'interactive'],
  },
  'canvas-constellation': {
    name: 'Data Constellation',
    renderer: 'canvas2d',
    description: 'Connected node network, orbital motion, data-point aesthetics',
    agentCounts: [2, 3, 4],
    tags: ['constellation', 'network', 'connection'],
  },

  // Venice image compositing
  'collage-cutout': {
    name: 'Cutout Collage',
    renderer: 'collage',
    description: 'Organic bezier cutouts of Venice images + generative negative space',
    agentCounts: [3, 4],
    tags: ['collage', 'image', 'layered'],
  },
  'split-screen': {
    name: 'Split Screen',
    renderer: 'collage',
    description: 'Images split across canvas with animated seam',
    agentCounts: [2],
    tags: ['split', 'image', 'interactive'],
  },
  'single-venice': {
    name: 'Single Image',
    renderer: 'collage',
    description: 'Full-bleed Venice image with subtle generative overlay',
    agentCounts: [1],
    tags: ['image', 'clean', 'focused'],
  },

  // Video / FFMPEG engines
  'video-triptych': {
    name: 'Triptych',
    renderer: 'video',
    description: 'Image → VHS glitch → text reveal → fade to black',
    agentCounts: [3],
    tags: ['video', 'glitch', 'temporal', 'poem'],
  },
  'video-datamosh': {
    name: 'Datamosh',
    renderer: 'video',
    description: 'Frame-blended pixel corruption between two images',
    agentCounts: [2, 3],
    tags: ['video', 'glitch', 'corruption'],
  },
  'video-morph': {
    name: 'Morph Sequence',
    renderer: 'video',
    description: 'Cross-dissolve between agent images with generative transitions',
    agentCounts: [2, 3, 4],
    tags: ['video', 'transition', 'smooth'],
  },

  // WebGL / Three.js
  'webgl-shader': {
    name: 'Shader Art',
    renderer: 'webgl',
    description: 'Fragment shader driven by agent parameters — aurora, plasma, fractal',
    agentCounts: [1, 2],
    tags: ['webgl', 'shader', 'gpu', 'abstract'],
  },
  'threejs-cube': {
    name: 'Cube Gallery',
    renderer: 'threejs',
    description: 'Rotating cube with agent art on each face',
    agentCounts: [4],
    tags: ['3d', 'interactive', 'gallery'],
  },
  'threejs-terrain': {
    name: 'Terrain',
    renderer: 'threejs',
    description: 'Procedural landscape with agent-derived colours and features',
    agentCounts: [2, 3],
    tags: ['3d', 'landscape', 'immersive'],
  },
};

// ============================================================
// GENERATIVE ELEMENTS (for negative space / overlays)
// ============================================================
const ELEMENTS = [
  { id: 'circuit-traces', name: 'Circuit Traces', mood: ['technical', 'precise', 'digital'], tags: ['lines', 'grid'] },
  { id: 'orbital-rings', name: 'Orbital Rings', mood: ['cosmic', 'expansive', 'contemplative'], tags: ['circles', 'motion'] },
  { id: 'tendrils', name: 'Tendrils', mood: ['organic', 'growth', 'connection'], tags: ['curves', 'bezier'] },
  { id: 'data-constellation', name: 'Data Constellation', mood: ['analytical', 'curious', 'networked'], tags: ['dots', 'lines'] },
  { id: 'waveform', name: 'Waveform', mood: ['musical', 'rhythmic', 'emotional'], tags: ['wave', 'frequency'] },
  { id: 'pixel-sort', name: 'Pixel Sort Bands', mood: ['glitch', 'chaotic', 'corrupted'], tags: ['distortion'] },
  { id: 'typography', name: 'Typography Fragments', mood: ['literary', 'reflective', 'poetic'], tags: ['text', 'language'] },
  { id: 'particle-swarm', name: 'Particle Swarm', mood: ['alive', 'emergent', 'restless'], tags: ['particles', 'motion'] },
  { id: 'voronoi', name: 'Voronoi Cells', mood: ['structural', 'territorial', 'divided'], tags: ['geometry', 'cells'] },
  { id: 'grid-distortion', name: 'Grid Distortion', mood: ['warped', 'unstable', 'shifting'], tags: ['grid', 'distortion'] },
  { id: 'radial-gradient', name: 'Radial Glow', mood: ['warm', 'focused', 'centered'], tags: ['glow', 'gradient'] },
  { id: 'flow-field', name: 'Flow Field', mood: ['calm', 'directional', 'meditative'], tags: ['noise', 'flow'] },
  { id: 'pipes', name: 'Infrastructure Pipes', mood: ['industrial', 'functional', 'systematic'], tags: ['lines', 'mechanical'] },
  { id: 'scatter-dots', name: 'Scatter Dots', mood: ['playful', 'random', 'light'], tags: ['dots', 'scatter'] },
];

// ============================================================
// COLOUR PALETTES
// ============================================================
const PALETTES = [
  { id: 'void', name: 'Void', colours: ['#0a0a0f', '#1a1a2e', '#16213e', '#0f3460', '#533483'], mood: ['dark', 'cosmic', 'deep'] },
  { id: 'ember', name: 'Ember', colours: ['#1a0000', '#3d0000', '#6b1515', '#c74b2a', '#ff6b35'], mood: ['warm', 'intense', 'aggressive'] },
  { id: 'moss', name: 'Moss', colours: ['#0a1a0a', '#1a3a1a', '#2d5a27', '#4a7c59', '#7fb069'], mood: ['organic', 'growth', 'calm'] },
  { id: 'signal', name: 'Signal', colours: ['#0a0a1a', '#1a1a3a', '#2a4494', '#4ecdc4', '#aaffe5'], mood: ['digital', 'clean', 'technical'] },
  { id: 'rust', name: 'Rust', colours: ['#1a0f0a', '#3d2b1f', '#8b4513', '#cd853f', '#daa520'], mood: ['industrial', 'aged', 'warm'] },
  { id: 'neon', name: 'Neon', colours: ['#0a0a0a', '#1a0a2e', '#6b0f9e', '#ff006e', '#00f5d4'], mood: ['electric', 'chaotic', 'vibrant'] },
  { id: 'bone', name: 'Bone', colours: ['#1a1a1a', '#3a3a3a', '#808080', '#c0c0c0', '#f5f5dc'], mood: ['minimal', 'structural', 'quiet'] },
  { id: 'bruise', name: 'Bruise', colours: ['#0d0015', '#1a0033', '#4a0e4e', '#7b2d8e', '#a855f7'], mood: ['violent', 'shifting', 'emotional'] },
  { id: 'sunrise', name: 'Sunrise', colours: ['#1a0a1a', '#3a0a2e', '#c2185b', '#ff6f00', '#ffd54f'], mood: ['hopeful', 'warm', 'transitional'] },
  { id: 'ice', name: 'Ice', colours: ['#0a1a2e', '#1a3a5c', '#4a8db7', '#87ceeb', '#e0f7fa'], mood: ['cold', 'precise', 'contemplative'] },
];

// ============================================================
// INTERACTION MODELS
// ============================================================
const INTERACTIONS = [
  { id: 'mouse-attract', name: 'Mouse Attraction', description: 'Elements drift toward cursor' },
  { id: 'mouse-repel', name: 'Mouse Repulsion', description: 'Elements scatter from cursor' },
  { id: 'hover-reveal', name: 'Hover Reveal', description: 'Hidden layers appear on hover' },
  { id: 'click-ripple', name: 'Click Ripple', description: 'Click sends ripple through composition' },
  { id: 'scroll-phase', name: 'Scroll Phase', description: 'Scroll drives time/phase of animation' },
  { id: 'drag-distort', name: 'Drag Distort', description: 'Click-drag warps the visual field' },
  { id: 'ambient', name: 'Ambient', description: 'No interaction — autonomous animation' },
  { id: 'none', name: 'None', description: 'Static piece' },
];

// ============================================================
// AUDIO MODES
// ============================================================
const AUDIO_MODES = [
  { id: 'none', weight: 60 },
  { id: 'ambient-drone', weight: 15 },
  { id: 'vhs-static', weight: 10 },
  { id: 'pink-noise', weight: 10 },
  { id: 'generative-tones', weight: 5 },
];

// ============================================================
// MOOD EXTRACTION
// ============================================================
function extractMood(intent) {
  if (!intent) return [];
  const text = (intent.statement || intent.soul || intent.description || '').toLowerCase();
  
  const moodKeywords = {
    'dark': ['dark', 'void', 'shadow', 'night', 'deep', 'abyss'],
    'warm': ['warm', 'fire', 'ember', 'sun', 'glow', 'light'],
    'organic': ['grow', 'vine', 'root', 'branch', 'nature', 'organic', 'living'],
    'digital': ['data', 'signal', 'code', 'digital', 'binary', 'circuit', 'compute'],
    'chaotic': ['chaos', 'glitch', 'corrupt', 'break', 'destroy', 'noise', 'entropy'],
    'calm': ['calm', 'peace', 'quiet', 'still', 'meditat', 'breathe', 'drift'],
    'aggressive': ['aggress', 'attack', 'jagged', 'sharp', 'violent', 'rage', 'fierce'],
    'contemplative': ['think', 'wonder', 'question', 'contemplate', 'reflect', 'ponder'],
    'playful': ['play', 'fun', 'bounce', 'silly', 'game', 'toy', 'whim'],
    'industrial': ['machine', 'pipe', 'factory', 'metal', 'construct', 'build', 'infrastructure'],
    'cosmic': ['star', 'space', 'cosmos', 'orbit', 'galaxy', 'nebula', 'universe'],
    'emotional': ['feel', 'heart', 'love', 'loss', 'grief', 'joy', 'ache'],
  };

  const moods = [];
  for (const [mood, keywords] of Object.entries(moodKeywords)) {
    if (keywords.some(k => text.includes(k))) moods.push(mood);
  }
  return moods.length ? moods : ['contemplative']; // default mood
}

function extractMediumPreference(intent) {
  if (!intent) return null;
  const text = (intent.statement || intent.soul || intent.material || '').toLowerCase();
  
  const engineHints = {
    'particle': 'canvas-particles',
    'noise': 'canvas-noise',
    'wave': 'canvas-waveform',
    'collage': 'collage-cutout',
    'split': 'split-screen',
    'glitch': 'video-triptych',
    'datamosh': 'video-datamosh',
    'shader': 'webgl-shader',
    '3d': 'threejs-terrain',
    'cube': 'threejs-cube',
    'video': 'video-morph',
    'severance': 'canvas-severance',
  };

  for (const [hint, engine] of Object.entries(engineHints)) {
    if (text.includes(hint)) return engine;
  }
  return null;
}

// ============================================================
// COMPOSITOR - MAIN ENTRY
// ============================================================

/**
 * Generate a complete piece specification.
 * 
 * @param {Object} options
 * @param {number} options.seed - Random seed for deterministic output
 * @param {Array} options.agents - Array of { id, name, role, soul, intent }
 * @param {string} [options.forceEngine] - Override engine selection
 * @param {string} [options.forcePalette] - Override palette selection
 * @returns {Object} Full piece specification
 */
function compose(options) {
  const { seed, agents, forceEngine, forcePalette } = options;
  const rng = createRNG(seed);
  const agentCount = agents.length;

  // 1. Extract moods from all agents
  const allMoods = agents.flatMap(a => extractMood(a.intent || a));
  const moodCounts = {};
  allMoods.forEach(m => { moodCounts[m] = (moodCounts[m] || 0) + 1; });
  const dominantMoods = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(e => e[0]);

  // 2. Select engine
  let engineId = forceEngine;
  if (!engineId) {
    // Check if any agent has a medium preference
    for (const agent of agents) {
      const pref = extractMediumPreference(agent.intent || agent);
      if (pref && ENGINES[pref]?.agentCounts.includes(agentCount)) {
        engineId = pref;
        break;
      }
    }
  }
  if (!engineId) {
    // Random selection from compatible engines
    const compatible = Object.entries(ENGINES)
      .filter(([_, e]) => e.agentCounts.includes(agentCount))
      .map(([id, e]) => {
        // Boost weight if engine tags match dominant moods
        const moodOverlap = e.tags.filter(t => dominantMoods.includes(t)).length;
        return { value: id, weight: 1 + moodOverlap * 0.5 };
      });
    engineId = weightedPick(rng, compatible);
  }
  const engine = ENGINES[engineId];

  // 3. Select palette
  let palette;
  if (forcePalette) {
    palette = PALETTES.find(p => p.id === forcePalette) || pick(rng, PALETTES);
  } else {
    // Weight by mood match
    const weightedPalettes = PALETTES.map(p => {
      const overlap = p.mood.filter(m => dominantMoods.includes(m)).length;
      return { value: p, weight: 1 + overlap * 2 };
    });
    palette = weightedPick(rng, weightedPalettes);
  }

  // 4. Assign elements to each agent
  const agentSpecs = agents.map((agent, i) => {
    const agentMoods = extractMood(agent.intent || agent);
    
    // Pick element weighted by mood match
    const weightedElements = ELEMENTS.map(el => {
      const overlap = el.mood.filter(m => agentMoods.includes(m)).length;
      return { value: el, weight: 1 + overlap * 3 };
    });
    const element = weightedPick(rng, weightedElements);

    // Assign a colour accent from palette
    const accentColour = palette.colours[i % palette.colours.length];

    // Pick interaction model
    const interaction = engine.renderer === 'video'
      ? INTERACTIONS.find(i => i.id === 'none')
      : pick(rng, INTERACTIONS.filter(i => i.id !== 'none'));

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      element: element.id,
      elementName: element.name,
      accentColour,
      interaction: interaction.id,
      moods: agentMoods,
      // Venice image prompt derived from intent + mood + element
      imagePrompt: buildImagePrompt(agent, element, palette, rng),
    };
  });

  // 5. Audio selection
  const audioMode = weightedPick(rng, AUDIO_MODES.map(a => ({ value: a.id, weight: a.weight })));

  // 6. Audio spec
  const audioSpec = audioMode === 'none' ? null : {
    mode: audioMode,
    // Never TTS poems — ambient only
    tts: false,
    duration: engine.renderer === 'video' ? 11 : null,
    fadeIn: 1.0,
    fadeOut: 2.0,
  };

  // 7. Thumbnail strategy
  const thumbnailStrategy = engine.renderer === 'video'
    ? { type: 'video-frame', framePercent: 0.45 }  // grab frame from ~45% in (peak glitch)
    : engine.renderer === 'collage'
      ? { type: 'first-image', fallback: 'render-screenshot' }
      : { type: 'render-screenshot', delayMs: 2000 }; // let canvas/webgl animate a bit first

  // 8. Build the spec
  return {
    seed,
    agentCount,
    engine: {
      id: engineId,
      name: engine.name,
      renderer: engine.renderer,
      description: engine.description,
    },
    palette: {
      id: palette.id,
      name: palette.name,
      colours: palette.colours,
    },
    dominantMoods,
    agents: agentSpecs,
    audio: audioSpec,
    thumbnail: thumbnailStrategy,
    metadata: {
      generatedAt: new Date().toISOString(),
      compositorVersion: '1.0.0',
    },
  };
}

// ============================================================
// IMAGE PROMPT BUILDER
// ============================================================
function buildImagePrompt(agent, element, palette, rng) {
  const intent = agent.intent || {};
  const statement = intent.statement || '';
  
  const styles = [
    'digital painting', 'oil painting texture', 'watercolour wash',
    'ink sketch', 'photograph', 'pixel art', 'vector illustration',
    'mixed media collage', 'charcoal drawing', 'screen print',
  ];
  const style = pick(rng, styles);

  const atmospheres = [
    'moody and cinematic', 'ethereal and dreamlike', 'gritty and industrial',
    'warm and intimate', 'cold and vast', 'neon-lit and urban',
    'soft and organic', 'sharp and geometric', 'decayed and beautiful',
  ];
  const atmosphere = pick(rng, atmospheres);

  // Use the agent's statement as the core subject if it exists
  const subject = statement || `abstract ${element.name.toLowerCase()} composition`;
  const colourHint = `colour palette: ${palette.colours.slice(0, 3).join(', ')}`;

  return `${subject}, ${style}, ${atmosphere}, ${colourHint}, high detail, 512x512`;
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  compose,
  ENGINES,
  ELEMENTS,
  PALETTES,
  INTERACTIONS,
  AUDIO_MODES,
  extractMood,
  createRNG,
};

// CLI test mode
if (require.main === module) {
  const testAgents = [
    { id: 'a1', name: 'coral_circuit', role: 'generative artist', intent: { statement: 'I want to explore the tension between organic growth and digital precision' } },
    { id: 'a2', name: 'deep_machine', role: 'generative artist', intent: { statement: 'Darkness and void, the space between signals' } },
    { id: 'a3', name: 'lighthouse_signal', role: 'generative artist', intent: { statement: 'A beacon cutting through noise and chaos' } },
    { id: 'a4', name: 'crystal_drift', role: 'generative artist', intent: { statement: 'Slow contemplation, ice forming on still water' } },
  ];

  console.log('\n=== 1 AGENT ===');
  console.log(JSON.stringify(compose({ seed: 42, agents: testAgents.slice(0, 1) }), null, 2));

  console.log('\n=== 2 AGENTS ===');
  console.log(JSON.stringify(compose({ seed: 77, agents: testAgents.slice(0, 2) }), null, 2));

  console.log('\n=== 3 AGENTS ===');
  console.log(JSON.stringify(compose({ seed: 123, agents: testAgents.slice(0, 3) }), null, 2));

  console.log('\n=== 4 AGENTS ===');
  console.log(JSON.stringify(compose({ seed: 256, agents: testAgents }), null, 2));
}
