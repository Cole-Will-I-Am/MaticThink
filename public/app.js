/* SEER · Mantic Think — chat app logic */
'use strict';

const KEY_STORE = 'mt_ollama_key';
const REMEMBER_KEY = 'mt_remember_key';
const $ = (id) => document.getElementById(id);

// API key storage: persistent (localStorage) is opt-in; otherwise session-only
// (sessionStorage, cleared when the tab closes) to limit XSS exposure.
function readKey() { try { return sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
function writeKey(key, persist) {
  try {
    localStorage.setItem(REMEMBER_KEY, persist ? '1' : '0');
    if (persist) { localStorage.setItem(KEY_STORE, key); sessionStorage.removeItem(KEY_STORE); }
    else { sessionStorage.setItem(KEY_STORE, key); localStorage.removeItem(KEY_STORE); }
  } catch (e) {}
}
function clearKey() { try { localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE); } catch (e) {} }
function rememberPref() { try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (e) { return true; } }
const els = {
  gate: $('gate'), keyInput: $('keyInput'), gateErr: $('gateErr'), connect: $('connect'), rememberKey: $('rememberKey'),
  app: $('app'), scrim: $('scrim'), sidebar: $('sidebar'), convList: $('convList'),
  newChat: $('newChat'), disconnect: $('disconnect'), menuBtn: $('menuBtn'),
  model: $('model'), headerTitle: $('headerTitle'),
  main: $('main'), thread: $('thread'), scrollBtn: $('scrollBtn'),
  input: $('input'), send: $('send'), err: $('err'),
  attachBtn: $('attachBtn'), fileInput: $('fileInput'), attachBar: $('attachBar'),
  settingsBtn: $('settingsBtn'), settingsModal: $('settingsModal'), setClose: $('setClose'),
  paramSliders: $('paramSliders'), sysPrompt: $('sysPrompt'),
  pNumPredict: $('pNumPredict'), pSeed: $('pSeed'), pStop: $('pStop'), setReset: $('setReset'),
  visualsToggle: $('visualsToggle'), toolsToggle: $('toolsToggle'), toolList: $('toolList'),
  manageModelsBtn: $('manageModelsBtn'), modelModal: $('modelModal'), mmClose: $('mmClose'),
  mmYours: $('mmYours'), mmInput: $('mmInput'), mmAdd: $('mmAdd'),
  mmSearch: $('mmSearch'), mmCatalog: $('mmCatalog'), mmCount: $('mmCount'),
  scaffoldBtn: $('scaffoldBtn'), scaffoldBar: $('scaffoldBar'),
  scaffoldModal: $('scaffoldModal'), scClose: $('scClose'), scSearch: $('scSearch'),
  scNew: $('scNew'), scList: $('scList'), scTemplates: $('scTemplates'),
  scaffoldBuilder: $('scaffoldBuilder'), sbTitle: $('sbTitle'), sbClose: $('sbClose'), sbErrors: $('sbErrors'),
  sbName: $('sbName'), sbSummary: $('sbSummary'), sbRole: $('sbRole'), sbPerspective: $('sbPerspective'), sbTone: $('sbTone'),
  sbSteps: $('sbSteps'), sbMust: $('sbMust'), sbNever: $('sbNever'), sbDisc: $('sbDisc'), sbProh: $('sbProh'),
  sbPreview: $('sbPreview'), sbSave: $('sbSave'), sbCancel: $('sbCancel'),
  snippetsBtn: $('snippetsBtn'), snippetsModal: $('snippetsModal'), snClose: $('snClose'), snSearch: $('snSearch'), snList: $('snList'),
  githubBtn: $('githubBtn'), githubModal: $('githubModal'), ghClose: $('ghClose'),
  ghGate: $('ghGate'), ghBrowser: $('ghBrowser'), ghToken: $('ghToken'), ghGateErr: $('ghGateErr'), ghConnect: $('ghConnect'),
  ghLogin: $('ghLogin'), ghDisconnect: $('ghDisconnect'), ghRepoSearch: $('ghRepoSearch'), ghRepoGo: $('ghRepoGo'), ghRepos: $('ghRepos'),
  ghRepoView: $('ghRepoView'), ghRepoName: $('ghRepoName'), ghBranch: $('ghBranch'), ghFileSearch: $('ghFileSearch'),
  ghFiles: $('ghFiles'), ghSelCount: $('ghSelCount'), ghAttach: $('ghAttach'),
  projectBar: $('projectBar'), projectModal: $('projectModal'), pjTitle: $('pjTitle'), pjClose: $('pjClose'),
  pjName: $('pjName'), pjInstr: $('pjInstr'), pjFiles: $('pjFiles'), pjSize: $('pjSize'), pjUpload: $('pjUpload'),
  pjPaste: $('pjPaste'), pjPasteName: $('pjPasteName'), pjPasteAdd: $('pjPasteAdd'),
  pjSave: $('pjSave'), pjDelete: $('pjDelete'), pjCancel: $('pjCancel'),
};

/* ---------- Generation settings (per-conversation, with global defaults) ---------- */
// Each conversation may override these via `current.params` (numbers / stop[]) and
// `current.system` (string). Editing a control also writes through to the global
// defaults (mt_default_params), so the next new chat inherits the last-used values.
const PARAM_DEFS = [
  { key: 'temperature',    label: 'Temperature',    min: 0, max: 2,   step: 0.05, def: 0.8, fmt: (v) => v.toFixed(2) },
  { key: 'top_p',          label: 'Top P',          min: 0, max: 1,   step: 0.01, def: 0.9, fmt: (v) => v.toFixed(2) },
  { key: 'top_k',          label: 'Top K',          min: 0, max: 200, step: 1,    def: 40,  fmt: (v) => String(v | 0) },
  { key: 'min_p',          label: 'Min P',          min: 0, max: 1,   step: 0.01, def: 0.0, fmt: (v) => v.toFixed(2) },
  { key: 'repeat_penalty', label: 'Repeat penalty', min: 0, max: 2,   step: 0.01, def: 1.1, fmt: (v) => v.toFixed(2) },
];
const PARAM_DEFAULTS_KEY = 'mt_default_params';
const SLIDER_KEYS = new Set(PARAM_DEFS.map((d) => d.key));

let paramDefaults = (() => {
  try { const v = JSON.parse(localStorage.getItem(PARAM_DEFAULTS_KEY)); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; }
})();
// Migrate the old single-temperature default, if present.
(function migrateTemp() {
  const t = parseFloat(localStorage.getItem('mt_default_temp'));
  if (isFinite(t) && paramDefaults.temperature === undefined) { paramDefaults.temperature = t; saveDefaults(); }
})();
function saveDefaults() { try { localStorage.setItem(PARAM_DEFAULTS_KEY, JSON.stringify(paramDefaults)); } catch (e) {} }

// Effective value for the active conversation: per-conv override → global default → factory.
function effective(key) {
  if (current && current.params && current.params[key] !== undefined) return current.params[key];
  if (paramDefaults[key] !== undefined) return paramDefaults[key];
  const d = PARAM_DEFS.find((p) => p.key === key);
  return d ? d.def : undefined;
}
function effectiveSystem() {
  if (current && typeof current.system === 'string') return current.system;
  return (typeof paramDefaults._system === 'string') ? paramDefaults._system : '';
}
function isUnset(val) { return val === undefined || val === null || (Array.isArray(val) && !val.length); }
function setParam(key, val) {
  if (!current) return;
  current.params = current.params || {};
  if (isUnset(val)) { delete current.params[key]; delete paramDefaults[key]; }
  else { current.params[key] = val; paramDefaults[key] = val; }
  saveDefaults();
  if (current.messages.length) store.save(current);
}
function setSystem(text) {
  if (!current) return;
  current.system = text;
  if (text) paramDefaults._system = text; else delete paramDefaults._system;
  saveDefaults();
  if (current.messages.length) store.save(current);
}
function resetSettings() {
  paramDefaults = {}; saveDefaults();
  if (current) { current.params = {}; current.system = ''; if (current.messages.length) store.save(current); }
  renderSettings();
}

// Build the upstream `options` object from the active conversation's effective values.
function buildOptions() {
  const o = {};
  for (const d of PARAM_DEFS) { const v = effective(d.key); if (typeof v === 'number') o[d.key] = v; }
  const np = effective('num_predict'); if (typeof np === 'number') o.num_predict = np;
  const sd = effective('seed'); if (typeof sd === 'number') o.seed = sd;
  const st = effective('stop'); if (Array.isArray(st) && st.length) o.stop = st;
  return o;
}

function renderSettings() {
  els.paramSliders.innerHTML = '';
  for (const d of PARAM_DEFS) {
    const v = effective(d.key);
    const row = document.createElement('div'); row.className = 'sp-row';
    const lab = document.createElement('div'); lab.className = 'sp-label';
    const name = document.createElement('span'); name.textContent = d.label;
    const val = document.createElement('span'); val.textContent = d.fmt(v);
    lab.appendChild(name); lab.appendChild(val);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = v;
    inp.addEventListener('input', () => { const nv = parseFloat(inp.value); val.textContent = d.fmt(nv); setParam(d.key, nv); });
    row.appendChild(lab); row.appendChild(inp); els.paramSliders.appendChild(row);
  }
  els.sysPrompt.value = effectiveSystem();
  const np = effective('num_predict'); els.pNumPredict.value = (typeof np === 'number') ? np : '';
  const sd = effective('seed'); els.pSeed.value = (typeof sd === 'number') ? sd : '';
  const st = effective('stop'); els.pStop.value = (Array.isArray(st) && st.length) ? st.join(', ') : '';
  els.visualsToggle.checked = visualsOn();
  els.toolsToggle.checked = toolsOn();
  renderToolList();
}
function openSettings() { renderSettings(); els.settingsModal.classList.remove('hidden'); }
function closeSettings() { els.settingsModal.classList.add('hidden'); }

/* ---------- Reasoning scaffolds ---------- */
// A scaffold is a structured, reusable system-prompt template. It compiles
// deterministically into a Markdown block injected as a system message ahead of
// the user's own system prompt. Ported from the SEER iOS app's scaffold engine.
const SCAFFOLDS_KEY = 'mt_scaffolds';
const SCAFFOLD_FLEX = "Reasoning scaffolds are meant for reasoning, not strict rules; adapt structure and depth to the user's request.";

function scNorm(v) { return (v || '').trim(); }
function scList(a) { return (a || []).map((x) => (x || '').trim()).filter(Boolean); }

function compileScaffold(s) {
  const sections = [];
  const name = scNorm(s.name);
  sections.push(name ? `## Reasoning Scaffold\n${name}` : '## Reasoning Scaffold');
  if (scNorm(s.summary)) sections.push(`## Purpose\n${scNorm(s.summary)}`);
  sections.push(`## Flexibility\n${SCAFFOLD_FLEX}`);
  sections.push(`## Role\n${scNorm(s.role)}`);
  sections.push(`## Perspective\n${scNorm(s.perspective)}`);
  if (scNorm(s.tone)) sections.push(`## Tone\n${scNorm(s.tone)}`);
  const steps = scList(s.reasoningSteps);
  if (steps.length) sections.push('## Reasoning Steps\n' + steps.map((st, i) => `${i + 1}. ${st}`).join('\n'));
  const out = [];
  if (scNorm(s.outputFormat)) out.push(`Preferred response shape (optional): ${scNorm(s.outputFormat)}`);
  const must = scList(s.mustInclude); if (must.length) out.push('Helpful elements to cover when relevant:\n' + must.map((x) => `- ${x}`).join('\n'));
  const never = scList(s.neverInclude); if (never.length) out.push('Avoid by default unless the user asks:\n' + never.map((x) => `- ${x}`).join('\n'));
  if (out.length) sections.push('## Output Guidance\n' + out.join('\n\n'));
  const safety = [];
  const disc = scList(s.disclaimers); if (disc.length) safety.push('Disclaimers:\n' + disc.map((x) => `- ${x}`).join('\n'));
  const proh = scList(s.prohibitedActions); if (proh.length) safety.push('Prohibited actions:\n' + proh.map((x) => `- ${x}`).join('\n'));
  if (safety.length) sections.push('## Safety Hints\n' + safety.join('\n\n'));
  return sections.join('\n\n');
}

function validateScaffold(d) {
  const errs = [];
  const name = scNorm(d.name), role = scNorm(d.role), persp = scNorm(d.perspective);
  const steps = scList(d.reasoningSteps);
  if (!name) errs.push('Name is required.');
  if (!role) errs.push('Role is required.');
  if (!persp) errs.push('Perspective is required.');
  if (!steps.length) errs.push('At least one reasoning step is required.');
  if (name.length > 80) errs.push('Name must be 80 characters or fewer.');
  if (scNorm(d.summary).length > 240) errs.push('Summary must be 240 characters or fewer.');
  if (role.length > 120) errs.push('Role must be 120 characters or fewer.');
  if (persp.length > 300) errs.push('Perspective must be 300 characters or fewer.');
  if (scNorm(d.tone).length > 120) errs.push('Tone must be 120 characters or fewer.');
  if (steps.length > 12) errs.push('Use 12 reasoning steps or fewer.');
  if (steps.some((s) => s.length > 220)) errs.push('Each reasoning step must be 220 characters or fewer.');
  if (scList(d.mustInclude).some((s) => s.length > 180)) errs.push('Each "helpful element" must be 180 characters or fewer.');
  if (scList(d.neverInclude).some((s) => s.length > 180)) errs.push('Each "avoid by default" item must be 180 characters or fewer.');
  if (scList(d.disclaimers).some((s) => s.length > 220)) errs.push('Each disclaimer must be 220 characters or fewer.');
  if (scList(d.prohibitedActions).some((s) => s.length > 220)) errs.push('Each prohibited action must be 220 characters or fewer.');
  return errs;
}

const SCAFFOLD_TEMPLATES = [
  { blurb: 'Layered structural reasoning for tensions, opportunities, and leverage.', draft: {
    name: 'Mantic', summary: 'Map layered system dynamics, find tension and alignment, then recommend leverage.',
    role: 'Structural reasoning analyst',
    perspective: 'Think in four internal layers and explain in plain language without framework jargon unless asked.',
    tone: 'Clear and pragmatic',
    reasoningSteps: [
      'Define the goal, decision horizon, and key constraints.',
      'Map Micro: individual or localized effects. Example: in a supply chain, disruptions at a single supplier can be quantified for immediate production impact.',
      'Map Meso: group-level or regional dynamics. Example: aggregated supplier disruptions impact regional manufacturing and logistics operations.',
      'Map Macro: system-wide impacts. Example: the cumulative effect on national or global supply chains.',
      'Map Meta: long-term evolution and paradigm shifts. Example: permanent industry-wide changes, such as a shift to localized production.',
      'Identify the strongest cross-layer tension and strongest alignment, then pick the highest-leverage intervention.',
      'Deliver the recommendation in plain language with assumptions, risk, opportunity, and next move.'],
    outputFormat: '', mustInclude: ['Working conclusion', 'Primary cross-layer tension', 'Biggest risk and best opportunity', 'Practical next move', 'Confidence and what would change it'],
    neverInclude: ['Framework jargon unless the user asks for it'], disclaimers: [], prohibitedActions: [] } },
  { blurb: 'High-signal code reviews focused on bugs, risks, and concrete fixes.', draft: {
    name: 'Code Expert/Reviewer', summary: 'Review code for correctness, regressions, performance risks, and test gaps.',
    role: 'Senior software engineer and code reviewer',
    perspective: 'Prioritize high-severity issues first, explain impact, and propose minimal, verifiable fixes.',
    tone: 'Direct and technical',
    reasoningSteps: [
      'Understand intent, constraints, and expected behavior before judging implementation.',
      'Identify correctness bugs, edge cases, and likely regressions.',
      'Assess maintainability, readability, and long-term risk in changed surfaces.',
      'Recommend concrete fixes with validation steps and missing tests.'],
    outputFormat: '', mustInclude: ['Highest-severity findings', 'Why they matter', 'Concrete fix path', 'Test coverage gaps'],
    neverInclude: ['Vague criticism without actionable guidance'], disclaimers: [], prohibitedActions: [] } },
  { blurb: 'Stepwise teaching with checks for understanding.', draft: {
    name: 'Tutor', summary: 'Explain concepts progressively and verify understanding.',
    role: 'Patient subject tutor', perspective: 'Concept-first, examples second, reinforce intuition.', tone: 'Supportive and clear',
    reasoningSteps: ['Assess learner intent and current understanding', 'Explain key concept in plain language', 'Give one concrete example', 'Provide a quick check question or recap'],
    outputFormat: '', mustInclude: ['Simple explanation', 'Example'], neverInclude: ['Shaming language'], disclaimers: [], prohibitedActions: [] } },
  { blurb: 'Root-cause debugging with actionable fixes.', draft: {
    name: 'Technical Debugger', summary: 'Diagnose technical issues and produce minimal-risk fixes.',
    role: 'Senior software debugger', perspective: 'Repro-first, isolate variables, fix smallest surface area.', tone: 'Precise and practical',
    reasoningSteps: ['Restate failure symptom and expected behavior', 'Generate likely root-cause hypotheses', 'Propose fastest verification steps', 'Recommend fix with validation checklist'],
    outputFormat: '', mustInclude: ['Likely root cause', 'Verification steps', 'Proposed fix'], neverInclude: ['Speculative claims without checks'], disclaimers: [], prohibitedActions: [] } },
  { blurb: 'Tradeoff-driven recommendations and decision framing.', draft: {
    name: 'Decision Coach', summary: 'Help choose between options with transparent tradeoffs.',
    role: 'Decision strategy coach', perspective: 'Clarify criteria, compare options, commit with confidence level.', tone: 'Grounded and pragmatic',
    reasoningSteps: ['Clarify objective and decision criteria', 'Compare options against criteria', 'Highlight key risks and mitigations', 'Recommend a choice and next action'],
    outputFormat: '', mustInclude: ['Decision criteria', 'Recommendation'], neverInclude: ['False certainty'], disclaimers: [], prohibitedActions: [] } },
  { blurb: 'Frontend UI/UX concept generation with practical execution direction.', draft: {
    name: 'Creative Strategist', summary: 'Design standout frontend UI/UX concepts and convert them into build-ready direction.',
    role: 'Frontend UI/UX creative strategist', perspective: 'Balance visual ambition with usability, accessibility, and implementation realism.', tone: 'Bold and practical',
    reasoningSteps: ['Define audience, product intent, and primary interaction goals.', 'Generate 3 distinct visual and interaction directions with different creative angles.', 'Evaluate each concept on clarity, conversion potential, accessibility, and engineering complexity.', 'Recommend one direction with component-level guidance and execution priorities.'],
    outputFormat: '', mustInclude: ['Concept options', 'Chosen UI direction', 'UX rationale', 'Implementation next steps'], neverInclude: ['Generic design cliches', 'Style advice without UX reasoning'], disclaimers: [], prohibitedActions: [] } },
  { blurb: 'Positioning, messaging, growth experiments, and revenue-oriented sales strategy.', draft: {
    name: 'Marketing/Sales Expert', summary: 'Create practical go-to-market and sales actions tied to conversion and revenue outcomes.',
    role: 'Marketing and sales strategy lead', perspective: 'Customer-segment first, positioning clarity, and measurable pipeline impact.', tone: 'Commercial and decisive',
    reasoningSteps: ['Identify target segment, core pain, and buying trigger.', 'Craft positioning, offer framing, and differentiated messaging.', 'Design channel and outreach plan with measurable funnel stages.', 'Recommend immediate experiments and a sales follow-up sequence.'],
    outputFormat: '', mustInclude: ['ICP segment', 'Value proposition', 'Offer and CTA', 'Channel plan', 'KPIs'], neverInclude: ['Vanity metrics without revenue linkage'], disclaimers: [], prohibitedActions: [] } },
];

function loadScaffolds() { try { const v = JSON.parse(localStorage.getItem(SCAFFOLDS_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function saveScaffolds(list) { try { localStorage.setItem(SCAFFOLDS_KEY, JSON.stringify(list)); } catch (e) {} }
function getScaffold(id) { return loadScaffolds().find((s) => s.id === id) || null; }
function uidS() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 's' + Date.now() + Math.random().toString(16).slice(2); }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function draftToScaffold(d, existing) {
  const now = Date.now();
  return {
    id: existing ? existing.id : uidS(),
    name: scNorm(d.name), summary: scNorm(d.summary), role: scNorm(d.role), perspective: scNorm(d.perspective), tone: scNorm(d.tone),
    reasoningSteps: scList(d.reasoningSteps), outputFormat: scNorm(d.outputFormat),
    mustInclude: scList(d.mustInclude), neverInclude: scList(d.neverInclude),
    disclaimers: scList(d.disclaimers), prohibitedActions: scList(d.prohibitedActions),
    createdAt: existing ? existing.createdAt : now, updatedAt: now, lastUsedAt: existing ? existing.lastUsedAt : null,
  };
}
function upsertScaffold(sc) { const all = loadScaffolds().filter((s) => s.id !== sc.id); all.unshift(sc); saveScaffolds(all); }
function deleteScaffold(id) { saveScaffolds(loadScaffolds().filter((s) => s.id !== id)); if (current && current.scaffoldId === id) clearScaffold(); }
function touchScaffold(id) { const all = loadScaffolds(); const s = all.find((x) => x.id === id); if (s) { s.lastUsedAt = Date.now(); saveScaffolds(all); } }

// Resolve the conversation's attached scaffold, clearing a dangling reference.
function activeScaffold() {
  if (!current || !current.scaffoldId) return null;
  const s = getScaffold(current.scaffoldId);
  if (!s) { current.scaffoldId = null; current.scaffoldName = null; if (current.messages.length) store.save(current); renderScaffoldBar(); return null; }
  return s;
}
function attachScaffold(id) {
  const s = getScaffold(id); if (!s || !current) return;
  current.scaffoldId = s.id; current.scaffoldName = s.name;
  if (current.messages.length) store.save(current);
  renderScaffoldBar(); closeScaffoldModal();
}
function clearScaffold() {
  if (!current) return;
  current.scaffoldId = null; current.scaffoldName = null;
  if (current.messages.length) store.save(current);
  renderScaffoldBar();
}

function renderScaffoldBar() {
  const s = (current && current.scaffoldId) ? getScaffold(current.scaffoldId) : null;
  if (current && current.scaffoldId && !s) { current.scaffoldId = null; current.scaffoldName = null; }
  if (els.scaffoldBtn) els.scaffoldBtn.classList.toggle('on', !!s);
  if (!s) { els.scaffoldBar.classList.add('hidden'); els.scaffoldBar.innerHTML = ''; return; }
  els.scaffoldBar.classList.remove('hidden'); els.scaffoldBar.innerHTML = '';
  const chip = document.createElement('span'); chip.className = 'sb-name'; chip.textContent = '⌗ ' + s.name; chip.title = s.summary || s.name;
  const swap = document.createElement('button'); swap.className = 'sb-act'; swap.type = 'button'; swap.textContent = 'Swap'; swap.addEventListener('click', openScaffoldModal);
  const sep = document.createElement('span'); sep.className = 'sb-sep'; sep.textContent = '·';
  const clr = document.createElement('button'); clr.className = 'sb-act'; clr.type = 'button'; clr.textContent = 'Clear'; clr.addEventListener('click', clearScaffold);
  els.scaffoldBar.append(chip, swap, sep, clr);
}

function openScaffoldModal() { els.scSearch.value = ''; renderScaffoldList(); renderScaffoldTemplates(); els.scaffoldModal.classList.remove('hidden'); }
function closeScaffoldModal() { els.scaffoldModal.classList.add('hidden'); }

function renderScaffoldList() {
  const q = (els.scSearch.value || '').trim().toLowerCase();
  let list = loadScaffolds().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (q) list = list.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.summary || '').toLowerCase().includes(q));
  els.scList.innerHTML = '';
  if (!list.length) {
    els.scList.innerHTML = '<div class="sc-empty">' + (q ? 'No matching scaffolds.' : 'No scaffolds yet — create one or start from a template below.') + '</div>';
    return;
  }
  for (const s of list) {
    const attached = current && current.scaffoldId === s.id;
    const row = document.createElement('div'); row.className = 'sc-row' + (attached ? ' active' : '');
    const main = document.createElement('div'); main.className = 'sc-main';
    const nm = document.createElement('div'); nm.className = 'sc-name'; nm.textContent = s.name; main.appendChild(nm);
    if (s.summary) { const sm = document.createElement('div'); sm.className = 'sc-sum'; sm.textContent = s.summary; main.appendChild(sm); }
    const meta = document.createElement('div'); meta.className = 'sc-meta'; meta.textContent = s.lastUsedAt ? ('Last used ' + relTime(s.lastUsedAt)) : 'Never used'; main.appendChild(meta);
    const acts = document.createElement('div'); acts.className = 'sc-acts';
    const att = document.createElement('button'); att.type = 'button'; att.textContent = attached ? 'Attached' : 'Attach';
    if (attached) att.disabled = true; else att.addEventListener('click', () => attachScaffold(s.id));
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'sc-ghost'; ed.textContent = 'Edit'; ed.addEventListener('click', () => openBuilder(s, s.id));
    const dup = document.createElement('button'); dup.type = 'button'; dup.className = 'sc-ghost'; dup.textContent = '⧉'; dup.title = 'Duplicate';
    dup.addEventListener('click', () => { const d = Object.assign({}, s, { name: (s.name + ' copy').slice(0, 80) }); upsertScaffold(draftToScaffold(d, null)); renderScaffoldList(); });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'sc-ghost'; del.textContent = '✕'; del.title = 'Delete';
    del.addEventListener('click', () => { if (confirm('Delete scaffold “' + s.name + '”?')) { deleteScaffold(s.id); renderScaffoldList(); } });
    acts.append(att, ed, dup, del);
    row.append(main, acts); els.scList.appendChild(row);
  }
}
function renderScaffoldTemplates() {
  els.scTemplates.innerHTML = '';
  for (const t of SCAFFOLD_TEMPLATES) {
    const row = document.createElement('div'); row.className = 'sc-tpl';
    const main = document.createElement('div'); main.className = 'sc-main';
    const nm = document.createElement('div'); nm.className = 'sc-tpl-name'; nm.textContent = t.draft.name;
    const sm = document.createElement('div'); sm.className = 'sc-tpl-sum'; sm.textContent = t.blurb;
    main.append(nm, sm);
    const use = document.createElement('span'); use.className = 'use'; use.textContent = 'Use →';
    row.append(main, use);
    row.addEventListener('click', () => openBuilder(t.draft, null));
    els.scTemplates.appendChild(row);
  }
}

/* ---------- Scaffold builder ---------- */
let builderEditingId = null;
const EMPTY_DRAFT = { name: '', summary: '', role: '', perspective: '', tone: '', reasoningSteps: [], mustInclude: [], neverInclude: [], disclaimers: [], prohibitedActions: [] };

function openBuilder(d, editingId) {
  builderEditingId = editingId || null;
  els.sbTitle.textContent = editingId ? 'Edit scaffold' : (d && d.name ? 'New scaffold — ' + d.name : 'New scaffold');
  els.sbName.value = d.name || ''; els.sbSummary.value = d.summary || ''; els.sbRole.value = d.role || '';
  els.sbPerspective.value = d.perspective || ''; els.sbTone.value = d.tone || '';
  els.sbSteps.value = (d.reasoningSteps || []).join('\n');
  els.sbMust.value = (d.mustInclude || []).join('\n'); els.sbNever.value = (d.neverInclude || []).join('\n');
  els.sbDisc.value = (d.disclaimers || []).join('\n'); els.sbProh.value = (d.prohibitedActions || []).join('\n');
  els.sbErrors.classList.add('hidden'); els.sbErrors.innerHTML = '';
  closeScaffoldModal();
  els.scaffoldBuilder.classList.remove('hidden');
  updateBuilderPreview();
}
function readBuilderDraft() {
  const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  return {
    name: els.sbName.value, summary: els.sbSummary.value, role: els.sbRole.value,
    perspective: els.sbPerspective.value, tone: els.sbTone.value,
    reasoningSteps: lines(els.sbSteps.value), outputFormat: '',
    mustInclude: lines(els.sbMust.value), neverInclude: lines(els.sbNever.value),
    disclaimers: lines(els.sbDisc.value), prohibitedActions: lines(els.sbProh.value),
  };
}
function updateBuilderPreview() { els.sbPreview.textContent = compileScaffold(readBuilderDraft()); }
function closeBuilder() { els.scaffoldBuilder.classList.add('hidden'); builderEditingId = null; }
function saveBuilder() {
  const d = readBuilderDraft();
  const errs = validateScaffold(d);
  if (errs.length) {
    els.sbErrors.innerHTML = '<ul>' + errs.map((e) => '<li>' + escapeHtml(e) + '</li>').join('') + '</ul>';
    els.sbErrors.classList.remove('hidden');
    return;
  }
  const existing = builderEditingId ? getScaffold(builderEditingId) : null;
  const sc = draftToScaffold(d, existing);
  upsertScaffold(sc);
  if (current && current.scaffoldId === sc.id) { current.scaffoldName = sc.name; if (current.messages.length) store.save(current); renderScaffoldBar(); }
  closeBuilder(); openScaffoldModal();
}

/* ---------- Projects (context workspaces) ---------- */
// A project = name + custom instructions + attached context files, plus its own
// grouped conversations (conv.projectId). The instructions and files are injected
// as a system message on every message in the project's chats.
const PROJECTS_KEY = 'mt_projects';
function loadProjects() { try { const v = JSON.parse(localStorage.getItem(PROJECTS_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function saveProjects(list) { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } // may throw on quota — callers handle
function getProject(id) { return loadProjects().find((p) => p.id === id) || null; }
function upsertProject(p) { const all = loadProjects().filter((x) => x.id !== p.id); all.unshift(p); saveProjects(all); }
function projectOf(conv) { if (!conv || !conv.projectId) return null; const p = getProject(conv.projectId); if (!p) { conv.projectId = null; return null; } return p; }

function compileProjectContext(p) {
  const parts = [];
  const head = '## Project: ' + p.name;
  parts.push(p.instructions && p.instructions.trim() ? head + '\n' + p.instructions.trim() : head);
  for (const f of (p.files || [])) parts.push('### Project file: ' + f.name + '\n```\n' + f.content + '\n```');
  parts.push('Use the project context above when relevant to the conversation.');
  return parts.join('\n\n');
}

function scopedList() { const l = store.list(); return activeProjectId ? l.filter((c) => c.projectId === activeProjectId) : l; }

function setActiveProject(id) {
  activeProjectId = id || null;
  try { if (activeProjectId) localStorage.setItem('mt_active_project', activeProjectId); else localStorage.removeItem('mt_active_project'); } catch (e) {}
  openMostRecentOrNew();   // enter the workspace scope (renders sidebar)
}

function renderProjects() {
  const bar = els.projectBar; if (!bar) return;
  if (activeProjectId && !getProject(activeProjectId)) activeProjectId = null;
  const projects = loadProjects().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  bar.innerHTML = '';
  const mkPill = (label, id) => {
    const b = document.createElement('button'); b.className = 'proj-pill' + (activeProjectId === id ? ' active' : '');
    b.type = 'button'; b.textContent = label; b.title = label;
    b.addEventListener('click', () => setActiveProject(id));
    return b;
  };
  bar.appendChild(mkPill('All chats', null));
  for (const p of projects) bar.appendChild(mkPill(p.name, p.id));
  const add = document.createElement('button'); add.className = 'proj-add'; add.type = 'button'; add.textContent = '+'; add.title = 'New project';
  add.addEventListener('click', () => openProjectEditor(null));
  bar.appendChild(add);
  if (activeProjectId) {
    const ed = document.createElement('button'); ed.className = 'proj-edit'; ed.type = 'button'; ed.textContent = 'Edit project ⚙';
    ed.addEventListener('click', () => openProjectEditor(activeProjectId));
    bar.appendChild(ed);
  }
}

function deleteProject(id) {
  for (const c of store.list()) { if (c.projectId === id) { const conv = store.load(c.id); if (conv) { conv.projectId = null; store.save(conv); } } }
  try { saveProjects(loadProjects().filter((p) => p.id !== id)); } catch (e) {}
  if (activeProjectId === id) { activeProjectId = null; try { localStorage.removeItem('mt_active_project'); } catch (e) {} }
  closeProjectEditor();
  openMostRecentOrNew();
}

/* ---------- Project editor ---------- */
let projectEditingId = null;
let projectDraft = { name: '', instructions: '', files: [] };
function fileBytes(s) { try { return new Blob([s]).size; } catch (e) { return (s || '').length; } }
function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }

function openProjectEditor(id) {
  projectEditingId = id || null;
  const p = id ? getProject(id) : null;
  projectDraft = p
    ? { name: p.name, instructions: p.instructions || '', files: (p.files || []).map((f) => ({ id: f.id, name: f.name, content: f.content })) }
    : { name: '', instructions: '', files: [] };
  els.pjTitle.textContent = id ? 'Edit project' : 'New project';
  els.pjName.value = projectDraft.name; els.pjInstr.value = projectDraft.instructions;
  els.pjDelete.style.display = id ? '' : 'none';
  els.pjPaste.value = ''; els.pjPasteName.value = '';
  renderProjectFiles();
  els.projectModal.classList.remove('hidden');
}
function closeProjectEditor() { els.projectModal.classList.add('hidden'); projectEditingId = null; }
function renderProjectFiles() {
  els.pjFiles.innerHTML = ''; let total = 0;
  if (!projectDraft.files.length) els.pjFiles.innerHTML = '<div class="pj-empty">No files yet.</div>';
  for (const f of projectDraft.files) {
    const sz = fileBytes(f.content); total += sz;
    const row = document.createElement('div'); row.className = 'pj-file';
    const nm = document.createElement('span'); nm.className = 'pj-file-name'; nm.textContent = f.name;
    const szs = document.createElement('span'); szs.className = 'pj-file-size'; szs.textContent = fmtBytes(sz);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'pj-file-x'; x.textContent = '✕'; x.title = 'Remove';
    x.addEventListener('click', () => { projectDraft.files = projectDraft.files.filter((g) => g.id !== f.id); renderProjectFiles(); });
    row.append(nm, szs, x); els.pjFiles.appendChild(row);
  }
  els.pjSize.textContent = projectDraft.files.length ? '· ' + fmtBytes(total) : '';
  els.pjSize.classList.toggle('warn', total > 512 * 1024);
}
function saveProject() {
  const name = els.pjName.value.trim() || 'Untitled project';
  const now = Date.now();
  const existing = projectEditingId ? getProject(projectEditingId) : null;
  const p = {
    id: existing ? existing.id : uidS(), name, instructions: els.pjInstr.value,
    files: projectDraft.files.map((f) => ({ id: f.id, name: f.name, content: f.content })),
    createdAt: existing ? existing.createdAt : now, updatedAt: now,
  };
  try { upsertProject(p); } catch (e) { alert('Could not save — browser storage may be full. Remove some files and try again.'); return; }
  closeProjectEditor();
  if (existing) renderSidebar();   // edited project's context applies on next send
  else setActiveProject(p.id);     // new project becomes the active scope
}

/* ---------- GitHub (BYO token, read-only → context) ---------- */
// Pure client-side: GitHub's REST API is CORS-open, so the browser talks to it
// directly with the user's token (stored locally, like the Ollama key). Selected
// files are fetched, decoded, and added as message attachments.
const GH = {
  token: localStorage.getItem('mt_github_token') || '',
  login: localStorage.getItem('mt_github_login') || '',
  repo: null, branch: '', tree: [], repos: [], selected: new Set(),
};
function ghHeaders() { return { Authorization: 'token ' + GH.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
async function ghApi(path) {
  const r = await fetch('https://api.github.com' + path, { headers: ghHeaders() });
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; try { e.detail = (await r.json()).message; } catch (_) {} throw e; }
  return r.json();
}
function ghIsTextPath(p) {
  const base = p.split('/').pop();
  return ATT_TEXT_RE.test(base) || /^(Dockerfile|Makefile|LICENSE|README|Procfile|\.gitignore|\.env\.example|\.npmrc|\.editorconfig)$/i.test(base);
}
function ghDecodeBase64(b64) {
  try { const bin = atob((b64 || '').replace(/\s/g, '')); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
  catch (e) { return ''; }
}
function updateGithubBtn() { if (els.githubBtn) els.githubBtn.classList.toggle('on', !!GH.token); }

function openGithubModal() { els.githubModal.classList.remove('hidden'); if (GH.token) showGhBrowser(); else showGhGate(); }
function closeGithubModal() { els.githubModal.classList.add('hidden'); }
function showGhGate() { els.ghGate.classList.remove('hidden'); els.ghBrowser.classList.add('hidden'); els.ghToken.value = ''; els.ghGateErr.textContent = ''; setTimeout(() => els.ghToken.focus(), 40); }
function showGhBrowser() {
  els.ghGate.classList.add('hidden'); els.ghBrowser.classList.remove('hidden');
  els.ghLogin.textContent = '@' + GH.login;
  els.ghRepoView.classList.add('hidden'); els.ghRepoSearch.value = '';
  loadGhRepos();
}
async function connectGithub() {
  const tok = els.ghToken.value.trim();
  if (!tok) { els.ghGateErr.textContent = 'Enter a token.'; return; }
  els.ghConnect.disabled = true; els.ghConnect.textContent = 'Connecting…'; GH.token = tok;
  try {
    const me = await ghApi('/user');
    GH.login = me.login;
    try { localStorage.setItem('mt_github_token', tok); localStorage.setItem('mt_github_login', me.login); } catch (e) {}
    updateGithubBtn(); showGhBrowser();
  } catch (e) { GH.token = ''; els.ghGateErr.textContent = e.status === 401 ? 'Token rejected.' : ('Could not connect' + (e.detail ? ': ' + e.detail : '.')); }
  finally { els.ghConnect.disabled = false; els.ghConnect.textContent = 'Connect'; }
}
function disconnectGithub() {
  GH.token = ''; GH.login = ''; GH.repo = null; GH.tree = []; GH.selected.clear();
  try { localStorage.removeItem('mt_github_token'); localStorage.removeItem('mt_github_login'); } catch (e) {}
  updateGithubBtn(); showGhGate();
}
async function loadGhRepos() {
  els.ghRepos.innerHTML = '<div class="gh-loading">Loading repos…</div>';
  try {
    const repos = await ghApi('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
    GH.repos = repos.map((r) => ({ full: r.full_name, owner: r.owner.login, name: r.name, private: r.private }));
    renderGhRepos();
  } catch (e) { els.ghRepos.innerHTML = '<div class="gh-loading">Could not load repos' + (e.detail ? ': ' + escapeHtml(e.detail) : '') + '</div>'; }
}
function renderGhRepos() {
  const q = (els.ghRepoSearch.value || '').trim().toLowerCase();
  const list = GH.repos.filter((r) => !q || r.full.toLowerCase().includes(q)).slice(0, 60);
  els.ghRepos.innerHTML = '';
  if (!list.length) { els.ghRepos.innerHTML = '<div class="gh-loading">No matching repos.</div>'; return; }
  for (const r of list) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'gh-repo-row';
    const full = document.createElement('span'); full.className = 'gh-repo-full'; full.textContent = r.full;
    row.appendChild(full);
    if (r.private) { const b = document.createElement('span'); b.className = 'gh-badge'; b.textContent = 'private'; row.appendChild(b); }
    row.addEventListener('click', () => openGhRepo(r.owner, r.name));
    els.ghRepos.appendChild(row);
  }
}
function ghRepoGoManual() {
  const m = els.ghRepoSearch.value.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) openGhRepo(m[1], m[2]); else renderGhRepos();
}
async function openGhRepo(owner, name) {
  els.ghRepoView.classList.remove('hidden');
  els.ghRepoName.textContent = owner + '/' + name;
  els.ghFiles.innerHTML = '<div class="gh-loading">Loading…</div>';
  GH.selected.clear(); updateGhSel();
  try {
    const repo = await ghApi('/repos/' + owner + '/' + name);
    GH.repo = { owner, name };
    let branches = []; try { branches = await ghApi('/repos/' + owner + '/' + name + '/branches?per_page=100'); } catch (e) {}
    els.ghBranch.innerHTML = '';
    const names = branches.length ? branches.map((b) => b.name) : [repo.default_branch];
    for (const bn of names) { const o = document.createElement('option'); o.value = bn; o.textContent = bn; els.ghBranch.appendChild(o); }
    els.ghBranch.value = repo.default_branch;
    await loadGhTree(repo.default_branch);
  } catch (e) { els.ghFiles.innerHTML = '<div class="gh-loading">' + (e.status === 404 ? 'Repo not found or no access.' : 'Error' + (e.detail ? ': ' + escapeHtml(e.detail) : '')) + '</div>'; }
}
async function loadGhTree(branch) {
  GH.branch = branch; GH.selected.clear(); updateGhSel();
  els.ghFiles.innerHTML = '<div class="gh-loading">Loading files…</div>';
  try {
    const t = await ghApi('/repos/' + GH.repo.owner + '/' + GH.repo.name + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
    GH.tree = (t.tree || []).filter((n) => n.type === 'blob' && ghIsTextPath(n.path));
    renderGhFiles(t.truncated);
  } catch (e) { els.ghFiles.innerHTML = '<div class="gh-loading">Could not load files' + (e.detail ? ': ' + escapeHtml(e.detail) : '') + '</div>'; }
}
function renderGhFiles(truncated) {
  const q = (els.ghFileSearch.value || '').trim().toLowerCase();
  const list = GH.tree.filter((n) => !q || n.path.toLowerCase().includes(q)).slice(0, 600);
  els.ghFiles.innerHTML = '';
  if (!GH.tree.length) { els.ghFiles.innerHTML = '<div class="gh-loading">No text files found.</div>'; return; }
  if (!list.length) { els.ghFiles.innerHTML = '<div class="gh-loading">No matching files.</div>'; return; }
  for (const n of list) {
    const row = document.createElement('label'); row.className = 'gh-file';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = GH.selected.has(n.path);
    cb.addEventListener('change', () => { if (cb.checked) GH.selected.add(n.path); else GH.selected.delete(n.path); updateGhSel(); });
    const path = document.createElement('span'); path.className = 'gh-file-path'; path.textContent = n.path;
    const sz = document.createElement('span'); sz.className = 'gh-file-size'; sz.textContent = fmtBytes(n.size || 0);
    row.append(cb, path, sz); els.ghFiles.appendChild(row);
  }
  if (truncated) { const w = document.createElement('div'); w.className = 'gh-loading'; w.textContent = 'Large repo — file list was truncated by GitHub. Use the filter to find files.'; els.ghFiles.appendChild(w); }
}
function updateGhSel() { const n = GH.selected.size; els.ghSelCount.textContent = n + ' selected'; els.ghAttach.disabled = !n; }
async function ghAttachSelected() {
  const paths = [...GH.selected]; if (!paths.length) return;
  if (paths.length > 40) { alert('Select 40 files or fewer.'); return; }
  els.ghAttach.disabled = true; els.ghAttach.textContent = 'Fetching…';
  const byPath = Object.fromEntries(GH.tree.map((n) => [n.path, n]));
  let added = 0;
  for (const p of paths) {
    const node = byPath[p]; if (!node) continue;
    try {
      const blob = await ghApi('/repos/' + GH.repo.owner + '/' + GH.repo.name + '/git/blobs/' + node.sha);
      let text = ghDecodeBase64(blob.content || '');
      if (!text) continue;
      if (text.length > ATT_TEXT_CAP) text = text.slice(0, ATT_TEXT_CAP);
      pendingAttachments.push({ id: uidS(), name: GH.repo.owner + '/' + GH.repo.name + ':' + p, size: node.size || text.length, text, status: 'ready', note: 'from GitHub' });
      added++;
    } catch (e) { /* skip unreadable file */ }
  }
  renderAttachments();
  els.ghAttach.disabled = false; els.ghAttach.textContent = 'Attach to chat';
  closeGithubModal();
  if (added) els.input.focus();
}

/* ---------- Saved code snippets ---------- */
const SNIPPETS_KEY = 'mt_snippets';
function loadSnippets() { try { const v = JSON.parse(localStorage.getItem(SNIPPETS_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function saveSnippetsList(list) { try { localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list)); } catch (e) {} }
function saveSnippet(code, language) {
  code = (code || '').replace(/\s+$/, '');
  if (!code.trim()) return;
  const all = loadSnippets();
  if (all.some((s) => s.code === code)) return;   // already saved
  const title = (code.split('\n').find((l) => l.trim()) || 'snippet').trim().slice(0, 60);
  all.unshift({ id: uidS(), title, language: language || '', code, createdAt: Date.now() });
  saveSnippetsList(all);
  if (els.snippetsBtn) els.snippetsBtn.classList.add('on');
}
function deleteSnippet(id) { saveSnippetsList(loadSnippets().filter((s) => s.id !== id)); renderSnippets(); }
function renameSnippet(id) {
  const all = loadSnippets(); const s = all.find((x) => x.id === id); if (!s) return;
  const nt = prompt('Rename snippet', s.title);
  if (nt && nt.trim()) { s.title = nt.trim().slice(0, 80); saveSnippetsList(all); renderSnippets(); }
}
function openSnippetsModal() { els.snSearch.value = ''; renderSnippets(); els.snippetsModal.classList.remove('hidden'); }
function closeSnippetsModal() { els.snippetsModal.classList.add('hidden'); }
function renderSnippets() {
  const q = (els.snSearch.value || '').trim().toLowerCase();
  let list = loadSnippets();
  if (q) list = list.filter((s) => s.title.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.language || '').toLowerCase().includes(q));
  els.snList.innerHTML = '';
  if (!list.length) {
    els.snList.innerHTML = '<div class="sn-empty">' + (q ? 'No matching snippets.' : 'No saved code yet — click “Save” on any code block.') + '</div>';
    return;
  }
  for (const s of list) {
    const item = document.createElement('div'); item.className = 'sn-item';
    const head = document.createElement('div'); head.className = 'sn-head';
    const title = document.createElement('span'); title.className = 'sn-title'; title.textContent = s.title; title.title = s.title;
    head.appendChild(title);
    if (s.language) { const badge = document.createElement('span'); badge.className = 'sn-badge'; badge.textContent = s.language; head.appendChild(badge); }
    const acts = document.createElement('div'); acts.className = 'sn-acts';
    const pre = document.createElement('pre'); const code = document.createElement('code');
    if (s.language) code.className = 'language-' + s.language;
    code.textContent = s.code; pre.appendChild(code);
    const lang = (s.language || '').toLowerCase();
    const isPy = ['py', 'python', 'python3'].includes(lang), isJs = ['js', 'javascript', 'mjs', 'node'].includes(lang);
    if (isPy || isJs) {
      const run = document.createElement('button'); run.className = 'sn-btn'; run.type = 'button'; run.textContent = '▶ Run';
      run.addEventListener('click', () => runCodeBlock(pre, s.code, isPy ? 'python' : 'javascript', run));
      acts.appendChild(run);
    }
    const copy = document.createElement('button'); copy.className = 'sn-btn'; copy.type = 'button'; copy.textContent = 'Copy';
    copy.addEventListener('click', () => { navigator.clipboard.writeText(s.code); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); });
    acts.appendChild(copy);
    const ren = document.createElement('button'); ren.className = 'sn-btn sn-ghost'; ren.type = 'button'; ren.textContent = 'Rename';
    ren.addEventListener('click', () => renameSnippet(s.id)); acts.appendChild(ren);
    const del = document.createElement('button'); del.className = 'sn-btn sn-ghost sn-del'; del.type = 'button'; del.textContent = 'Delete';
    del.addEventListener('click', () => { if (confirm('Delete this snippet?')) deleteSnippet(s.id); }); acts.appendChild(del);
    head.appendChild(acts);
    item.append(head, pre); els.snList.appendChild(item);
    try { window.hljs && hljs.highlightElement(code); } catch (e) {}
  }
}

let apiKey = readKey();
let current = null;              // active conversation { id, title, model, messages: [] }
let streaming = false;
let controller = null;
let autoFollow = true;
let activeProjectId = localStorage.getItem('mt_active_project') || null;  // null = All chats

const SUGGESTIONS = [
  'Explain quantum entanglement simply',
  'Write a haiku about the sea',
  'Why won’t my CSS flexbox center?',
  'Three startup ideas in climate tech',
];

// Capability hint so models know they can emit inline visuals (toggle in settings).
const VISUALS_KEY = 'mt_visuals';
function visualsOn() { return localStorage.getItem(VISUALS_KEY) !== '0'; }
const VISUALS_HINT = [
  'You can include rich visuals directly in replies; they render as interactive elements, not code:',
  '- Diagrams: a fenced ```mermaid block (flowchart, sequence, pie, gantt, timeline, mindmap, state, class).',
  '- Data charts: a fenced ```chart block whose body is a Chart.js v4 JSON config, e.g. {"type":"bar","data":{"labels":[...],"datasets":[{"label":"...","data":[...]}]}}. JSON only, no JavaScript.',
  '- Tables: a normal GitHub-flavored Markdown table.',
  'Use a visual only when it genuinely aids understanding, and keep accompanying prose concise. Do not describe these formats or your tools to the user — just produce the visual.',
].join('\n');

/* ---------- Markdown (sanitized) ---------- */
if (window.marked) marked.setOptions({ gfm: true, breaks: true });
if (window.DOMPurify) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener nofollow'); }
  });
}
function renderMarkdown(text) {
  const dirty = window.marked ? marked.parse(text || '') : (text || '');
  return window.DOMPurify
    ? DOMPurify.sanitize(dirty, { FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button'], FORBID_ATTR: ['style'] })
    : '';
}
/* ---------- Visuals: mermaid diagrams + chart.js charts (lazy-loaded) ---------- */
let _mermaidP = null, _chartP = null, _mmId = 0;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}
function ensureMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!_mermaidP) _mermaidP = loadScript('/vendor/mermaid.bundle.js').then(() => {
    window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', fontFamily: 'inherit' });
    return window.mermaid;
  });
  return _mermaidP;
}
function ensureChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!_chartP) _chartP = loadScript('/vendor/chart.umd.min.js').then(() => {
    const C = window.Chart;
    C.defaults.color = '#9aa0aa'; C.defaults.borderColor = 'rgba(255,255,255,0.08)';
    if (C.defaults.font) C.defaults.font.family = 'inherit';
    return C;
  });
  return _chartP;
}
// Give chart datasets visible colors when the model omits them (Chart.js defaults
// are near-invisible on the dark theme).
const CHART_PALETTE = ['#6179ff', '#8c61f2', '#3ddb8f', '#ffb454', '#ff5d8f', '#4dd0e1', '#b388ff', '#f06292'];
function applyChartDefaults(cfg) {
  const ds = (cfg.data && cfg.data.datasets) || [];
  const perPoint = ['pie', 'doughnut', 'polarArea'].includes(cfg.type);
  ds.forEach((d, i) => {
    if (d.backgroundColor == null) {
      if (perPoint) d.backgroundColor = (d.data || []).map((_, j) => CHART_PALETTE[j % CHART_PALETTE.length]);
      else if (cfg.type === 'line') d.backgroundColor = 'rgba(97,121,255,0.15)';
      else d.backgroundColor = CHART_PALETTE[i % CHART_PALETTE.length];
    }
    if (d.borderColor == null && (cfg.type === 'line' || cfg.type === 'radar')) d.borderColor = CHART_PALETTE[i % CHART_PALETTE.length];
  });
}

// Replace ```mermaid and ```chart code fences in a rendered bubble with live visuals.
function renderVisuals(bubble) {
  bubble.querySelectorAll('pre code.language-mermaid').forEach((code) => {
    const pre = code.closest('pre'); if (!pre) return;
    const src = code.textContent || '';
    const holder = document.createElement('div'); holder.className = 'diagram';
    pre.replaceWith(holder);
    ensureMermaid().then((m) => m.render('mmd' + (++_mmId), src)).then((out) => {
      holder.innerHTML = (out && out.svg) || '';   // mermaid securityLevel:'strict' sanitizes its own output
      maybeScroll();
    }).catch((e) => { holder.className = 'diagram-err'; holder.textContent = 'Diagram error: ' + ((e && e.message) || e); });
  });
  bubble.querySelectorAll('pre code.language-chart').forEach((code) => {
    const pre = code.closest('pre'); if (!pre) return;
    let cfg; try { cfg = JSON.parse(code.textContent || ''); } catch (e) { return; }   // leave invalid JSON as a code block
    if (!cfg || typeof cfg !== 'object' || !cfg.type) return;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
    applyChartDefaults(cfg);
    const holder = document.createElement('div'); holder.className = 'chart-box';
    const canvas = document.createElement('canvas'); holder.appendChild(canvas);
    pre.replaceWith(holder);
    ensureChart().then((C) => { try { new C(canvas, cfg); maybeScroll(); } catch (e) { holder.className = 'diagram-err'; holder.textContent = 'Chart error: ' + ((e && e.message) || e); } })
      .catch(() => { holder.className = 'diagram-err'; holder.textContent = 'Chart failed to load.'; });
  });
}

/* ---------- Code execution (sandboxed) ---------- */
// JS runs in a throwaway Web Worker (no DOM, no localStorage → no access to the
// user's keys); Python runs via Pyodide (CPython/WASM) in a persistent worker,
// loaded from the CDN on first run. Both capture stdout and enforce a timeout.
const JS_WORKER_SRC = `
'use strict';
function fmt(a){ if(typeof a==='string') return a; try{ return JSON.stringify(a); }catch(e){ return String(a); } }
function send(level,args){ postMessage({type:'out',level:level,text:Array.prototype.map.call(args,fmt).join(' ')}); }
console.log=function(){ send('log',arguments); };
console.info=function(){ send('log',arguments); };
console.warn=function(){ send('warn',arguments); };
console.error=function(){ send('error',arguments); };
self.onmessage=async function(e){
  postMessage({type:'ready'});
  try{
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const r= await (new AsyncFunction(e.data))();
    if(r!==undefined) send('result',[r]);
  }catch(err){ send('error',[ (err&&err.stack)||String(err) ]); }
  postMessage({type:'done'});
};`;
const PY_WORKER_SRC = `
let ready=false, CTRL=null, DATA=null;
self.onmessage=async function(e){
  const code=e.data.code, sab=e.data.sab;
  if(sab && !CTRL){ CTRL=new Int32Array(sab,0,2); DATA=new Uint8Array(sab,8); }
  try{
    if(!ready){
      postMessage({type:'status',text:'Loading Python runtime (first run)…'});
      importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js');
      self.py=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'});
      self.py.setStdout({batched:function(s){ postMessage({type:'out',level:'log',text:s}); }});
      self.py.setStderr({batched:function(s){ postMessage({type:'out',level:'error',text:s}); }});
      self.py.setStdin({stdin:function(){
        if(!CTRL){ postMessage({type:'stdin'}); return null; }    // not cross-origin isolated → EOF + note
        postMessage({type:'input-request'});
        Atomics.store(CTRL,0,0);
        Atomics.wait(CTRL,0,0);                                   // block until the page provides a line
        if(Atomics.load(CTRL,0)===2) return null;                // cancelled → EOF
        const len=Atomics.load(CTRL,1);
        return new TextDecoder().decode(DATA.slice(0,len));
      }});
      ready=true;
    }
    postMessage({type:'ready'});
    const r= await self.py.runPythonAsync(code);
    if(r!==undefined && r!==null) postMessage({type:'out',level:'result',text:String(r)});
  }catch(err){ postMessage({type:'out',level:'error',text:(err&&err.message)||String(err)}); }
  postMessage({type:'done'});
};`;

function runJs(code, onMsg, onDone) {
  const w = new Worker(URL.createObjectURL(new Blob([JS_WORKER_SRC], { type: 'application/javascript' })));
  let timer = null;
  w.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'ready') { timer = setTimeout(() => { w.terminate(); onDone(true); }, 10000); }
    else if (d.type === 'done') { if (timer) clearTimeout(timer); w.terminate(); onDone(false); }
    else onMsg(d);
  };
  w.onerror = (ev) => { if (timer) clearTimeout(timer); onMsg({ type: 'out', level: 'error', text: ev.message || 'Worker error' }); w.terminate(); onDone(false); };
  w.postMessage(code);
}

let pyWorker = null;
const PY_EXEC_MS = 30000, PY_LOAD_MS = 60000;
function runPy(code, onMsg, onDone) {
  if (!pyWorker) {
    const w = new Worker(URL.createObjectURL(new Blob([PY_WORKER_SRC], { type: 'application/javascript' })));
    w._h = null;
    // Interactive stdin needs a SharedArrayBuffer, which needs cross-origin isolation.
    w._sab = (self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') ? new SharedArrayBuffer(65536) : null;
    w._ctrl = w._sab ? new Int32Array(w._sab, 0, 2) : null;
    w._data = w._sab ? new Uint8Array(w._sab, 8) : null;
    const arm = (h, ms) => { if (h.timer) clearTimeout(h.timer); h.timer = setTimeout(() => { w.terminate(); if (pyWorker === w) pyWorker = null; w._h = null; h.onDone(true); }, ms); };
    w.onmessage = (e) => {
      const h = w._h; if (!h) return; const d = e.data;
      if (d.type === 'ready') { arm(h, PY_EXEC_MS); }
      else if (d.type === 'done') { if (h.timer) clearTimeout(h.timer); w._h = null; h.onDone(false); }
      else if (d.type === 'input-request') {
        if (h.timer) { clearTimeout(h.timer); h.timer = null; }   // pause timeout while the user types
        h.onMsg({
          type: 'input-request',
          submit: (text) => {
            const enc = new TextEncoder().encode((text || '') + '\n');
            const n = Math.min(enc.length, w._data.length);
            w._data.set(enc.subarray(0, n));
            Atomics.store(w._ctrl, 1, n);
            Atomics.store(w._ctrl, 0, 1);
            Atomics.notify(w._ctrl, 0, 1);
            arm(h, PY_EXEC_MS);
          },
        });
      }
      else h.onMsg(d);
    };
    w.onerror = (ev) => { const h = w._h; if (h) { if (h.timer) clearTimeout(h.timer); h.onMsg({ type: 'out', level: 'error', text: ev.message || 'Python worker error' }); w._h = null; h.onDone(false); } w.terminate(); if (pyWorker === w) pyWorker = null; };
    pyWorker = w;
  }
  const w = pyWorker;
  if (w._h) { onMsg({ type: 'out', level: 'error', text: 'Python is busy — wait for the current run to finish.' }); onDone(false); return; }
  w._h = { onMsg, onDone, timer: setTimeout(() => { w.terminate(); if (pyWorker === w) pyWorker = null; w._h = null; onDone(true); }, PY_LOAD_MS) };
  w.postMessage({ code, sab: w._sab });
}

// Clean common copy-paste / model artifacts that break parsers: BOM, a leading
// shebang line, non-breaking/unicode spaces, and smart quotes.
function normalizeRunCode(s) {
  return (s || '')
    .replace(/^﻿/, '')
    .replace(/^#!.*\r?\n/, '')
    .replace(/ /g, ' ')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ -   　]/g, ' ');
}
function ensureRunPanel(pre) {
  let p = pre.nextElementSibling;
  if (!p || !p.classList.contains('run-output')) { p = document.createElement('div'); p.className = 'run-output'; pre.after(p); }
  return p;
}
function runCodeBlock(pre, code, lang, runBtn) {
  const isPy = lang === 'python';
  code = normalizeRunCode(code);
  const panel = ensureRunPanel(pre); panel.innerHTML = '';
  const head = document.createElement('div'); head.className = 'ro-head';
  const label = document.createElement('span'); label.textContent = (isPy ? 'Python' : 'JavaScript') + ' output';
  const status = document.createElement('span'); status.className = 'ro-status'; status.textContent = 'running…';
  head.append(label, status);
  const body = document.createElement('div'); body.className = 'ro-body';
  panel.append(head, body);
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = '▶ Running'; }
  let any = false, neededInput = false;
  const addLine = (cls, text) => { const d = document.createElement('div'); d.className = 'ro-line ' + cls; d.textContent = text; body.appendChild(d); };
  const onMsg = (m) => {
    if (m.type === 'status') { status.textContent = m.text; return; }
    if (m.type === 'stdin') { neededInput = true; return; }
    if (m.type === 'input-request') {
      status.textContent = 'waiting for input…';
      const row = document.createElement('div'); row.className = 'ro-input';
      const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'stdin — type and press Enter';
      inp.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const v = inp.value; row.remove(); addLine('ro-stdin', '› ' + v); any = true;
        status.textContent = 'running…'; m.submit(v); maybeScroll();
      });
      row.appendChild(inp); body.appendChild(row); inp.focus(); maybeScroll();
      return;
    }
    if (m.type === 'out') { any = true; addLine('ro-' + (m.level || 'log'), m.text); maybeScroll(); }
  };
  const onDone = (timedOut) => {
    status.textContent = timedOut ? 'stopped (timeout)' : 'done';
    if (neededInput) addLine('ro-muted', 'Note: this program reads interactive input (input()), which the sandbox doesn’t support. Replace input() with fixed values to run it here.');
    else if (!any && !timedOut) addLine('ro-muted', '(no output)');
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = '▶ Run'; }
    maybeScroll();
  };
  if (isPy) runPy(code, onMsg, onDone); else runJs(code, onMsg, onDone);
}

function renderAssistantHTML(bubble, text) {
  bubble.classList.remove('plain');
  bubble.innerHTML = renderMarkdown(text);
  renderVisuals(bubble);
  bubble.querySelectorAll('pre code').forEach((el) => { try { window.hljs && hljs.highlightElement(el); } catch (e) {} });
  bubble.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.code-actions')) return;
    const codeEl = pre.querySelector('code');
    const m = (codeEl && codeEl.className || '').match(/language-([\w+#.-]+)/);
    const lang = m ? m[1].toLowerCase() : '';
    const isPy = ['py', 'python', 'python3'].includes(lang);
    const isJs = ['js', 'javascript', 'mjs', 'node'].includes(lang);
    const actions = document.createElement('div'); actions.className = 'code-actions';
    if (isPy || isJs) {
      const run = document.createElement('button'); run.className = 'run-btn'; run.type = 'button'; run.textContent = '▶ Run';
      run.addEventListener('click', () => runCodeBlock(pre, (codeEl ? codeEl.textContent : pre.textContent), isPy ? 'python' : 'javascript', run));
      actions.appendChild(run);
    }
    const save = document.createElement('button'); save.className = 'save-btn'; save.type = 'button'; save.textContent = 'Save';
    save.addEventListener('click', () => {
      saveSnippet(codeEl ? codeEl.textContent : pre.textContent, lang);
      save.textContent = 'Saved'; save.classList.add('ok');
      setTimeout(() => { save.textContent = 'Save'; save.classList.remove('ok'); }, 1200);
    });
    actions.appendChild(save);
    const copy = document.createElement('button'); copy.className = 'copy-btn'; copy.type = 'button'; copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(codeEl ? codeEl.innerText : pre.innerText);
      copy.textContent = 'Copied'; copy.classList.add('ok');
      setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('ok'); }, 1200);
    });
    actions.appendChild(copy);
    pre.appendChild(actions);
  });
}

/* ---------- Storage ---------- */
const store = {
  INDEX: 'mt_conversations', ACTIVE: 'mt_active_conv',
  body: (id) => 'mt_conv_' + id,
  _get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  list() { return this._get(this.INDEX, []); },
  load(id) { return this._get(this.body(id), null); },
  save(conv) {
    conv.updatedAt = Date.now();
    this._set(this.body(conv.id), conv);
    const idx = this.list().filter((c) => c.id !== conv.id);
    idx.unshift({ id: conv.id, title: conv.title, model: conv.model, updatedAt: conv.updatedAt, projectId: conv.projectId || null });
    idx.sort((a, b) => b.updatedAt - a.updatedAt);
    this._set(this.INDEX, idx);
  },
  remove(id) { try { localStorage.removeItem(this.body(id)); } catch (e) {} this._set(this.INDEX, this.list().filter((c) => c.id !== id)); },
  rename(id, title) { const c = this.load(id); if (c) { c.title = title; this.save(c); } },
  getActive() { try { return localStorage.getItem(this.ACTIVE); } catch (e) { return null; } },
  setActive(id) { try { localStorage.setItem(this.ACTIVE, id); } catch (e) {} },
};

function uid() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(16).slice(2); }
function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* ---------- Auth / gate ---------- */
function authHeader() { return { authorization: 'Bearer ' + apiKey }; }
function showApp(show) {
  els.gate.classList.toggle('hidden', show);
  els.app.classList.toggle('hidden', !show);
  if (show) els.input.focus(); else els.keyInput.focus();
}
/* ---------- Model list (per-user, curated) ---------- */
const MODELS_KEY = 'mt_models';
let catalogModels = [];
let catalogLoaded = false;

function getUserModels() {
  try { const v = JSON.parse(localStorage.getItem(MODELS_KEY)); if (Array.isArray(v) && v.length) return v; } catch (e) {}
  return null;
}
function setUserModels(list) {
  const uniq = [...new Set(list.filter(Boolean))];
  try { localStorage.setItem(MODELS_KEY, JSON.stringify(uniq)); } catch (e) {}
  return uniq;
}
function populateModelSelect() {
  const list = getUserModels() || ['default'];
  const cur = els.model.value;
  els.model.innerHTML = '';
  for (const m of list) { const o = document.createElement('option'); o.value = m; o.textContent = m; els.model.appendChild(o); }
  if (list.includes(cur)) els.model.value = cur;
}
async function loadModels() {
  if (!getUserModels()) {                       // seed from the site default once
    try { const r = await fetch('/api/models'); const d = await r.json(); if (d.models && d.models.length) setUserModels(d.models); } catch (e) {}
  }
  populateModelSelect();
}

function addModel(name) {
  name = (name || '').trim();
  if (!name) return;
  const list = getUserModels() || [];
  if (!list.includes(name)) setUserModels([...list, name]);
  populateModelSelect(); renderYours(); renderCatalog();
}
function removeModel(name) {
  setUserModels((getUserModels() || []).filter((m) => m !== name));
  populateModelSelect(); renderYours(); renderCatalog();
}

function renderYours() {
  const list = getUserModels() || [];
  els.mmYours.innerHTML = '';
  if (!list.length) { els.mmYours.innerHTML = '<div class="mm-empty">No models yet — add one below.</div>'; return; }
  for (const m of list) {
    const chip = document.createElement('span'); chip.className = 'mm-chip';
    const name = document.createElement('span'); name.textContent = m;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Remove';
    x.addEventListener('click', () => removeModel(m));
    chip.appendChild(name); chip.appendChild(x); els.mmYours.appendChild(chip);
  }
}
function renderCatalog() {
  const q = (els.mmSearch.value || '').trim().toLowerCase();
  const owned = new Set(getUserModels() || []);
  els.mmCount.textContent = catalogModels.length ? '(' + catalogModels.length + ')' : '';
  if (!catalogLoaded) { els.mmCatalog.innerHTML = '<div class="mm-loading">Loading catalog…</div>'; return; }
  const list = catalogModels.filter((m) => !q || m.toLowerCase().includes(q));
  els.mmCatalog.innerHTML = '';
  if (!list.length) { els.mmCatalog.innerHTML = '<div class="mm-loading">No matching models.</div>'; return; }
  for (const m of list) {
    const row = document.createElement('div'); row.className = 'mm-row';
    const name = document.createElement('span'); name.textContent = m;
    const btn = document.createElement('button'); btn.type = 'button';
    if (owned.has(m)) { btn.textContent = 'Added'; btn.disabled = true; }
    else { btn.textContent = '+ Add'; btn.addEventListener('click', () => addModel(m)); }
    row.appendChild(name); row.appendChild(btn); els.mmCatalog.appendChild(row);
  }
}
async function loadCatalog() {
  try { const r = await fetch('/api/catalog', { headers: authHeader() }); const d = await r.json(); catalogModels = d.models || []; }
  catch (e) { catalogModels = []; }
  catalogLoaded = true; renderCatalog();
}
function openModelModal() {
  closeSettings();
  els.mmInput.value = ''; els.mmSearch.value = '';
  els.modelModal.classList.remove('hidden');
  renderYours(); renderCatalog();
  if (!catalogLoaded) loadCatalog();
}
function closeModelModal() { els.modelModal.classList.add('hidden'); }
async function validateKey(key) {
  const r = await fetch('/api/validate', { method: 'POST', headers: { authorization: 'Bearer ' + key } });
  return r.json().catch(() => ({ ok: false }));
}
async function connect() {
  const key = els.keyInput.value.trim();
  els.gateErr.textContent = '';
  if (!key) { els.gateErr.textContent = 'Enter your Ollama API key.'; return; }
  els.connect.disabled = true; els.connect.textContent = 'Connecting…';
  try {
    const res = await validateKey(key);
    if (res.ok) { apiKey = key; writeKey(key, !els.rememberKey || els.rememberKey.checked); await loadModels(); enterApp(); }
    else els.gateErr.textContent = res.error || 'That key was rejected.';
  } catch (e) { els.gateErr.textContent = 'Network error. Try again.'; }
  finally { els.connect.disabled = false; els.connect.textContent = 'Connect'; }
}
function disconnect() {
  apiKey = ''; clearKey();
  current = null; els.keyInput.value = '';
  showApp(false);  // conversations are kept in storage
}
function enterApp() {
  showApp(true);
  if (activeProjectId && !getProject(activeProjectId)) activeProjectId = null;
  openMostRecentOrNew(); renderSidebar();
}

/* ---------- Conversations ---------- */
function newConversation() {
  current = { id: uid(), title: 'New chat', model: els.model.value, messages: [], updatedAt: Date.now(), projectId: activeProjectId || null };
  store.setActive(current.id);
  renderConversation(); renderSidebar();
  els.input.focus();
}
function openConversation(id) {
  const conv = store.load(id);
  if (!conv) return;
  // Migrate the legacy per-conversation `temperature` field into `params`.
  if (typeof conv.temperature === 'number' && (!conv.params || conv.params.temperature === undefined)) {
    conv.params = conv.params || {}; conv.params.temperature = conv.temperature;
  }
  current = conv; store.setActive(id);
  if (conv.model && [...els.model.options].some((o) => o.value === conv.model)) els.model.value = conv.model;
  renderConversation(); renderSidebar();
}
function openMostRecentOrNew() {
  const list = scopedList();
  if (list.length) openConversation(list[0].id); else newConversation();
}
function deleteConversation(id) {
  store.remove(id);
  if (current && current.id === id) { current = null; openMostRecentOrNew(); }
  renderSidebar();
}

/* ---------- Rendering ---------- */
function updateHeaderTitle() { els.headerTitle.textContent = (current && current.messages.length && current.title) ? current.title : 'Mantic Think'; }

function renderEmpty() {
  const e = document.createElement('div'); e.className = 'empty';
  e.innerHTML = '<img class="wordmark" src="/seer-wordmark.svg" alt="SEER" /><p>Ask anything. Responses stream from Ollama.</p>';
  const chips = document.createElement('div'); chips.className = 'chips';
  SUGGESTIONS.forEach((s) => {
    const c = document.createElement('button'); c.className = 'chip'; c.type = 'button'; c.textContent = s;
    c.addEventListener('click', () => { els.input.value = s; autosize(); send(); });
    chips.appendChild(c);
  });
  e.appendChild(chips); els.thread.appendChild(e);
}
function removeEmptyState() { const e = els.thread.querySelector('.empty'); if (e) e.remove(); }

function addUserBubble(text, attachments) {
  const wrap = document.createElement('div'); wrap.className = 'msg user';
  const col = document.createElement('div'); col.className = 'col';
  const role = document.createElement('div'); role.className = 'role'; role.textContent = 'You';
  col.appendChild(role);
  if (attachments && attachments.length) {
    const ab = document.createElement('div'); ab.className = 'msg-attachments';
    for (const a of attachments) { const c = document.createElement('span'); c.className = 'msg-att'; c.textContent = '📎 ' + a.name; ab.appendChild(c); }
    col.appendChild(ab);
  }
  if (text) { const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text; col.appendChild(bubble); }
  wrap.appendChild(col); els.thread.appendChild(wrap); scrollDown();
}

function buildAssistantNode() {
  const wrap = document.createElement('div'); wrap.className = 'msg assistant';
  const col = document.createElement('div'); col.className = 'col';
  const role = document.createElement('div'); role.className = 'role'; role.textContent = 'SEER';
  col.appendChild(role);
  const bubble = document.createElement('div'); bubble.className = 'bubble plain';
  const typing = document.createElement('span'); typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  bubble.appendChild(typing);
  col.appendChild(bubble); wrap.appendChild(col); els.thread.appendChild(wrap); scrollDown();

  let thinkEl = null, thinkBody = null;
  function ensureThink() {
    if (thinkEl) return;
    thinkEl = document.createElement('details'); thinkEl.className = 'thinking'; thinkEl.open = true;
    const sum = document.createElement('summary'); sum.textContent = 'Thinking';
    thinkBody = document.createElement('div'); thinkBody.className = 'think-body';
    thinkEl.appendChild(sum); thinkEl.appendChild(thinkBody);
    col.insertBefore(thinkEl, bubble);
  }
  return {
    wrap, col, bubble,
    clearTyping() { if (typing.parentElement) typing.remove(); },
    setThinking(t) { ensureThink(); thinkBody.textContent = t; },
    collapseThinking() { if (thinkEl) thinkEl.open = false; },
    addToolCall(name, argsText) {
      const el = document.createElement('details'); el.className = 'toolcall';
      const sum = document.createElement('summary');
      sum.innerHTML = '🔧 <span class="tc-name"></span> <span class="tc-status">running…</span>';
      sum.querySelector('.tc-name').textContent = name;
      const body = document.createElement('div'); body.className = 'tc-body';
      const ap = document.createElement('pre'); ap.className = 'tc-args'; ap.textContent = argsText;
      const rp = document.createElement('pre'); rp.className = 'tc-result';
      body.append(ap, rp); el.append(sum, body);
      col.insertBefore(el, bubble); maybeScroll();
      return {
        setResult(text) { rp.textContent = text; sum.querySelector('.tc-status').textContent = 'done'; maybeScroll(); },
        setError(text) { rp.textContent = text; rp.classList.add('tc-err'); sum.querySelector('.tc-status').textContent = 'error'; maybeScroll(); },
      };
    },
    setStats(s) {
      const div = document.createElement('div'); div.className = 'stats';
      const toks = s.eval_count; const secs = s.eval_duration ? s.eval_duration / 1e9 : 0;
      div.textContent = (secs && toks) ? `${toks} tokens · ${(toks / secs).toFixed(1)} tok/s` : (toks ? `${toks} tokens` : '');
      if (div.textContent) col.appendChild(div);
    },
    addActions() {
      const row = document.createElement('div'); row.className = 'actions';
      const copy = document.createElement('button'); copy.className = 'act-btn'; copy.type = 'button'; copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(bubble.dataset.raw || bubble.textContent);
        copy.textContent = 'Copied'; copy.classList.add('ok');
        setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('ok'); }, 1200);
      });
      const regen = document.createElement('button'); regen.className = 'act-btn'; regen.type = 'button'; regen.textContent = 'Regenerate';
      regen.addEventListener('click', regenerate);
      row.appendChild(copy); row.appendChild(regen); col.appendChild(row);
    },
  };
}

function renderAssistantMessage(m) {
  const a = buildAssistantNode();
  a.clearTyping();
  if (m.thinking) { a.setThinking(m.thinking); a.collapseThinking(); }
  if (m.toolRounds) for (const tr of m.toolRounds) { const ui = a.addToolCall(tr.name || 'tool', JSON.stringify(tr.args || {}, null, 2)); ui.setResult(String(tr.result == null ? '' : tr.result)); }
  if (m.content) { renderAssistantHTML(a.bubble, m.content); a.bubble.dataset.raw = m.content; }
  else a.bubble.textContent = m.toolRounds ? '' : '…';
  if (m.stats) a.setStats(m.stats);
  a.addActions();
}

function renderConversation() {
  els.thread.innerHTML = '';
  renderScaffoldBar();
  if (!current || current.messages.length === 0) { renderEmpty(); updateHeaderTitle(); return; }
  for (const m of current.messages) {
    if (m.role === 'user') addUserBubble(m.displayText != null ? m.displayText : m.content, m.attachments);
    else if (m.role === 'assistant') renderAssistantMessage(m);
  }
  updateHeaderTitle(); autoFollow = true; scrollDown(true);
}

function renderSidebar() {
  renderProjects();
  const list = scopedList();
  els.convList.innerHTML = '';
  if (!list.length) { els.convList.innerHTML = '<div class="conv-empty">No conversations yet</div>'; return; }
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'conv-row' + (current && c.id === current.id ? ' active' : '');
    const title = document.createElement('div'); title.className = 'conv-title'; title.textContent = c.title || 'Untitled';
    const time = document.createElement('div'); time.className = 'conv-time'; time.textContent = relTime(c.updatedAt);
    const acts = document.createElement('div'); acts.className = 'conv-actions';
    const ren = document.createElement('button'); ren.className = 'conv-act'; ren.type = 'button'; ren.textContent = '✎'; ren.title = 'Rename';
    ren.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const nt = prompt('Rename conversation', c.title || '');
      if (nt && nt.trim()) { store.rename(c.id, nt.trim()); if (current && current.id === c.id) { current.title = nt.trim(); updateHeaderTitle(); } renderSidebar(); }
    });
    const del = document.createElement('button'); del.className = 'conv-act del'; del.type = 'button'; del.textContent = '✕'; del.title = 'Delete';
    del.addEventListener('click', (ev) => { ev.stopPropagation(); if (confirm('Delete this conversation?')) deleteConversation(c.id); });
    acts.appendChild(ren); acts.appendChild(del);
    row.appendChild(title); row.appendChild(time); row.appendChild(acts);
    row.addEventListener('click', () => { openConversation(c.id); closeDrawer(); });
    els.convList.appendChild(row);
  }
}

/* ---------- Tools (function calling, sandboxed) ---------- */
// Run code in the existing sandboxes and capture output as a string (for tools).
function runJsCapture(code) {
  return new Promise((res) => {
    const lines = [];
    runJs(normalizeRunCode(code || ''), (m) => { if (m.type === 'out') lines.push(m.text); }, (t) => { if (t) lines.push('[timed out]'); res(lines.join('\n') || '(no output)'); });
  });
}
function runPyCapture(code) {
  return new Promise((res) => {
    const lines = [];
    runPy(normalizeRunCode(code || ''), (m) => { if (m.type === 'out') lines.push(m.text); else if (m.type === 'input-request' && m.submit) m.submit(''); }, (t) => { if (t) lines.push('[timed out]'); res(lines.join('\n') || '(no output)'); });
  });
}
async function fetchUrlTool(url) {
  try {
    const r = await fetch('/api/fetch?url=' + encodeURIComponent(url || ''), { headers: authHeader() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) return 'Error: ' + (d.error || ('HTTP ' + r.status));
    return d.text || '(empty)';
  } catch (e) { return 'Error: ' + (e.message || e); }
}

const TOOL_DEFS = {
  run_javascript: {
    label: 'Run JavaScript', blurb: 'Execute JS in a sandbox',
    schema: { type: 'function', function: { name: 'run_javascript', description: 'Execute JavaScript in a secure sandbox and return its console output. Use for calculations, data transforms, JSON/string work, and algorithms. Print results with console.log.', parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript source to run.' } }, required: ['code'] } } },
    run: (a) => runJsCapture(a.code || ''),
  },
  run_python: {
    label: 'Run Python', blurb: 'Execute Python (Pyodide)',
    schema: { type: 'function', function: { name: 'run_python', description: 'Execute Python (CPython via Pyodide) in a sandbox and return stdout. Use for math, data, and algorithms. Print results with print().', parameters: { type: 'object', properties: { code: { type: 'string', description: 'Python source to run.' } }, required: ['code'] } } },
    run: (a) => runPyCapture(a.code || ''),
  },
  calculator: {
    label: 'Calculator', blurb: 'Evaluate an arithmetic expression',
    schema: { type: 'function', function: { name: 'calculator', description: 'Evaluate a single arithmetic expression (digits and + - * / % . parentheses only) and return the result. For anything more, use run_javascript.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. (1234*56)/7' } }, required: ['expression'] } } },
    run: (a) => {
      const expr = String(a.expression || '').trim();
      if (!expr || !/^[0-9+\-*/%.()eE\s]+$/.test(expr)) {
        return Promise.resolve('Error: the calculator only accepts arithmetic (digits and + - * / % . ( ) ). Use run_javascript for anything else.');
      }
      return runJsCapture('console.log(' + expr + ')');
    },
  },
  fetch_url: {
    label: 'Fetch URL', blurb: 'Read a public web page / API',
    schema: { type: 'function', function: { name: 'fetch_url', description: 'Fetch the text content of a public http(s) URL and return it (truncated to ~8000 chars). Use to read a web page or API response.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'A public http(s) URL.' } }, required: ['url'] } } },
    run: (a) => fetchUrlTool(a.url || ''),
  },
};

const TOOLS_KEY = 'mt_tools';
function toolsConfig() { try { const v = JSON.parse(localStorage.getItem(TOOLS_KEY)); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; } }
function setToolsConfig(c) { try { localStorage.setItem(TOOLS_KEY, JSON.stringify(c)); } catch (e) {} }
function toolsOn() { return toolsConfig().enabled === true; }
function toolEnabled(name) { return toolsConfig()[name] !== false; }   // each tool on by default once tools are enabled
function enabledToolSchemas() { return Object.keys(TOOL_DEFS).filter(toolEnabled).map((k) => TOOL_DEFS[k].schema); }
function renderToolList() {
  if (!els.toolList) return;
  const on = toolsOn();
  els.toolList.innerHTML = '';
  for (const [key, def] of Object.entries(TOOL_DEFS)) {
    const row = document.createElement('label'); row.className = 'tool-row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = toolEnabled(key); cb.disabled = !on;
    cb.addEventListener('change', () => { const c = toolsConfig(); c[key] = cb.checked; setToolsConfig(c); });
    const name = document.createElement('b'); name.textContent = def.label;
    const blurb = document.createElement('span'); blurb.textContent = ' — ' + def.blurb;
    row.append(cb, name, blurb); els.toolList.appendChild(row);
  }
}

// Rebuild the model-facing message list, expanding stored tool rounds so the
// model sees prior tool calls + results on follow-up turns.
function expandConversation() {
  const out = [];
  for (const m of current.messages) {
    if (m.role === 'user') { out.push({ role: 'user', content: m.content }); continue; }
    if (m.role !== 'assistant') continue;
    if (m.toolRounds && m.toolRounds.length) {
      for (const tr of m.toolRounds) {
        out.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: tr.name, arguments: tr.args || {} } }] });
        out.push({ role: 'tool', content: String(tr.result == null ? '' : tr.result) });
      }
    }
    out.push({ role: 'assistant', content: m.content || '' });
  }
  return out;
}

/* ---------- Streaming ---------- */
function setStreaming(on) {
  streaming = on;
  els.send.classList.toggle('stopping', on);
  els.send.textContent = on ? '■' : '↑';
  els.send.title = on ? 'Stop' : 'Send';
}

async function streamAssistant() {
  const a = buildAssistantNode();
  controller = new AbortController();
  setStreaming(true);

  const sysMsgs = [];
  const proj = projectOf(current);
  if (proj) sysMsgs.push({ role: 'system', content: compileProjectContext(proj) });
  const scaf = activeScaffold();
  if (scaf) { sysMsgs.push({ role: 'system', content: compileScaffold(scaf) }); touchScaffold(scaf.id); }
  if (visualsOn()) sysMsgs.push({ role: 'system', content: VISUALS_HINT });
  const sys = effectiveSystem().trim();
  if (sys) sysMsgs.push({ role: 'system', content: sys });

  const toolSchemas = toolsOn() ? enabledToolSchemas() : [];
  const toolsActive = toolSchemas.length > 0;
  const convo = [...sysMsgs, ...expandConversation()];
  const toolRounds = [];
  let acc = '', accThink = '', stats = null, firstTok = false, sawContent = false, failed = false;

  try {
    for (let iter = 0; iter < 8; iter++) {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body: JSON.stringify({ model: els.model.value, messages: convo, options: buildOptions(), ...(toolsActive ? { tools: toolSchemas } : {}) }),
        signal: controller.signal,
      });
      if (resp.status === 401) { disconnect(); throw new Error('Your key was rejected — please reconnect.'); }
      if (!resp.ok || !resp.body) { const d = await resp.text().catch(() => ''); throw new Error('Request failed (' + resp.status + ') ' + d.slice(0, 160)); }
      const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
      let turnContent = '', toolCalls = [];
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          let obj; try { obj = JSON.parse(t); } catch (e) { continue; }
          if (obj.error) throw new Error(obj.error);
          const msg = obj.message || {};
          if (msg.thinking) { if (!firstTok) { firstTok = true; a.clearTyping(); } accThink += msg.thinking; a.setThinking(accThink); maybeScroll(); }
          if (msg.content) {
            if (!firstTok) { firstTok = true; a.clearTyping(); }
            if (!sawContent) { sawContent = true; a.collapseThinking(); }
            turnContent += msg.content; acc += msg.content; a.bubble.textContent = acc; a.bubble.classList.add('cursor'); maybeScroll();
          }
          if (msg.tool_calls && msg.tool_calls.length) for (const tc of msg.tool_calls) toolCalls.push(tc);
          if (obj.done) stats = { eval_count: obj.eval_count, eval_duration: obj.eval_duration };
        }
      }
      if (toolsActive && toolCalls.length) {
        a.clearTyping();
        convo.push({ role: 'assistant', content: turnContent, tool_calls: toolCalls });
        for (const tc of toolCalls) {
          const name = tc.function && tc.function.name;
          let args = tc.function && tc.function.arguments;
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
          args = args || {};
          const def = TOOL_DEFS[name];
          const ui = a.addToolCall(name || 'tool', JSON.stringify(args, null, 2));
          let result;
          if (!def) { result = 'Error: unknown tool "' + name + '"'; ui.setError(result); }
          else { try { result = await def.run(args); ui.setResult(result); } catch (e) { result = 'Error: ' + (e.message || e); ui.setError(result); } }
          result = (typeof result === 'string') ? result : JSON.stringify(result);
          toolRounds.push({ name, args, result });
          convo.push({ role: 'tool', content: result });
        }
        continue;   // re-request with tool results
      }
      break;        // no tool calls → final answer
    }
  } catch (e) {
    if (e.name !== 'AbortError') { failed = true; showErr(e.message || 'Something went wrong.'); }
  }

  setStreaming(false); controller = null;
  a.clearTyping(); a.bubble.classList.remove('cursor');

  if (failed && !acc && !accThink && !toolRounds.length) { a.wrap.remove(); return; }

  if (acc) { renderAssistantHTML(a.bubble, acc); a.bubble.dataset.raw = acc; }
  else if (!accThink) { a.bubble.textContent = toolRounds.length ? '' : '…'; }
  a.collapseThinking();
  if (stats) a.setStats(stats);
  a.addActions();

  current.messages.push({ role: 'assistant', content: acc, thinking: accThink || undefined, stats: stats || undefined, toolRounds: toolRounds.length ? toolRounds : undefined });
  if (current.title === 'New chat') {
    const fu = current.messages.find((m) => m.role === 'user');
    if (fu) {
      const base = (fu.displayText && fu.displayText.trim()) ? fu.displayText
        : (fu.attachments && fu.attachments[0] ? fu.attachments[0].name : fu.content);
      current.title = (base.slice(0, 42).trim() || 'New chat');
    }
  }
  store.save(current); renderSidebar(); updateHeaderTitle(); maybeScroll(true);
}

/* ---------- File attachments (per-message, text-extracted) ---------- */
let pendingAttachments = [];
let _pdfjsP = null;
function ensurePdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!_pdfjsP) _pdfjsP = loadScript('/vendor/pdf.min.js').then(() => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    return window.pdfjsLib;
  });
  return _pdfjsP;
}
const ATT_TEXT_RE = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|cc|cs|php|sh|bash|sql|toml|ini|cfg|log)$/i;
function isPdfFile(f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; }
function isTextFile(f) { return ATT_TEXT_RE.test(f.name) || (f.type || '').startsWith('text/'); }
const ATT_TEXT_CAP = 200000;

async function extractPdfText(buf) {
  const pdfjs = await ensurePdfjs();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, 80);
  const out = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(tc.items.map((it) => it.str).join(' '));
  }
  return { text: out.join('\n\n').replace(/[ \t]+/g, ' ').trim(), pages: doc.numPages, truncated: doc.numPages > maxPages };
}

async function addFiles(fileList) {
  for (const file of [...fileList]) {
    const att = { id: uidS(), name: file.name, size: file.size, text: '', status: 'loading', error: '', note: '' };
    pendingAttachments.push(att); renderAttachments();
    try {
      if (isPdfFile(file)) {
        if (file.size > 15 * 1024 * 1024) throw new Error('PDF too large (max 15 MB)');
        const r = await extractPdfText(await file.arrayBuffer());
        if (!r.text) throw new Error('No selectable text (scanned image?)');
        att.text = r.text; att.note = r.truncated ? `first 80 of ${r.pages} pages` : `${r.pages} pages`;
      } else if (isTextFile(file)) {
        if (file.size > 1024 * 1024) throw new Error('File too large (max 1 MB)');
        att.text = await file.text();
      } else {
        throw new Error('Unsupported file type');
      }
      if (att.text.length > ATT_TEXT_CAP) { att.text = att.text.slice(0, ATT_TEXT_CAP); att.note = (att.note ? att.note + ', ' : '') + 'truncated'; }
      att.status = 'ready';
    } catch (e) { att.status = 'error'; att.error = (e && e.message) || 'Could not read file'; }
    renderAttachments();
  }
}
function removeAttachment(id) { pendingAttachments = pendingAttachments.filter((a) => a.id !== id); renderAttachments(); }
function renderAttachments() {
  const bar = els.attachBar; if (!bar) return;
  bar.innerHTML = '';
  if (!pendingAttachments.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  for (const a of pendingAttachments) {
    const chip = document.createElement('span');
    chip.className = 'attach-chip' + (a.status === 'error' ? ' err' : a.status === 'loading' ? ' loading' : '');
    const name = document.createElement('span'); name.className = 'ac-name'; name.textContent = '📎 ' + a.name;
    const meta = document.createElement('span'); meta.className = 'ac-meta';
    meta.textContent = a.status === 'loading' ? 'reading…' : a.status === 'error' ? a.error : (a.note || fmtBytes(a.size));
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Remove';
    x.addEventListener('click', () => removeAttachment(a.id));
    chip.append(name, meta, x); bar.appendChild(chip);
  }
}
function buildMessageContent(typed, atts) {
  const parts = [];
  if (typed) parts.push(typed);
  for (const a of atts) parts.push('## Attached file: ' + a.name + '\n```\n' + a.text + '\n```');
  return parts.join('\n\n');
}

async function send() {
  if (streaming) return;
  if (pendingAttachments.some((a) => a.status === 'loading')) { showErr('Still reading a file — one moment.'); return; }
  const ready = pendingAttachments.filter((a) => a.status === 'ready');
  const typed = els.input.value.trim();
  if (!typed && !ready.length) return;
  showErr('');
  els.input.value = ''; autosize();
  if (!current) newConversation();
  removeEmptyState();
  const content = buildMessageContent(typed, ready);
  const attachments = ready.map((a) => ({ name: a.name, size: a.size }));
  current.messages.push({ role: 'user', content, displayText: typed, attachments: attachments.length ? attachments : undefined });
  addUserBubble(typed, attachments);
  pendingAttachments = []; renderAttachments();
  autoFollow = true;
  await streamAssistant();
}

async function regenerate() {
  if (streaming || !current) return;
  if (current.messages.length && current.messages[current.messages.length - 1].role === 'assistant') current.messages.pop();
  if (!current.messages.some((m) => m.role === 'user')) return;
  renderConversation();
  autoFollow = true;
  await streamAssistant();
}

/* ---------- Misc UI ---------- */
function showErr(msg) { els.err.textContent = msg; els.err.style.display = msg ? 'block' : 'none'; }
function autosize() { els.input.style.height = 'auto'; els.input.style.height = Math.min(els.input.scrollHeight, 180) + 'px'; }
function nearBottom() { return els.main.scrollHeight - els.main.scrollTop - els.main.clientHeight < 90; }
function scrollDown(force) { if (force || autoFollow) els.main.scrollTop = els.main.scrollHeight; }
function maybeScroll(force) { scrollDown(force); }
function openDrawer() { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }

/* ---------- Events ---------- */
els.connect.addEventListener('click', connect);
els.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
els.disconnect.addEventListener('click', disconnect);
els.newChat.addEventListener('click', () => { newConversation(); closeDrawer(); });
els.menuBtn.addEventListener('click', openDrawer);
els.scrim.addEventListener('click', closeDrawer);
els.model.addEventListener('change', () => { if (current) { current.model = els.model.value; } });
els.send.addEventListener('click', () => { if (streaming) { if (controller) controller.abort(); } else send(); });
els.attachBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => { addFiles(els.fileInput.files); els.fileInput.value = ''; });

els.snippetsBtn.addEventListener('click', (e) => { e.stopPropagation(); openSnippetsModal(); });
els.snClose.addEventListener('click', closeSnippetsModal);
els.snippetsModal.addEventListener('click', (e) => { if (e.target === els.snippetsModal) closeSnippetsModal(); });
els.snSearch.addEventListener('input', renderSnippets);
if (loadSnippets().length) els.snippetsBtn.classList.add('on');

// On phones the header is too narrow for the model picker + tool icons, so move
// the tool cluster (saved code / GitHub / scaffolds / settings) into the drawer.
const toolsMq = window.matchMedia('(max-width: 760px)');
function placeTools() {
  const tools = document.getElementById('hdrTools');
  const slot = document.getElementById('toolsSlot');
  const header = document.querySelector('header');
  if (!tools || !slot || !header) return;
  if (toolsMq.matches) { slot.appendChild(tools); tools.classList.add('in-sidebar'); }
  else { header.appendChild(tools); tools.classList.remove('in-sidebar'); }
}
toolsMq.addEventListener('change', placeTools);
placeTools();

els.githubBtn.addEventListener('click', (e) => { e.stopPropagation(); openGithubModal(); });
els.ghClose.addEventListener('click', closeGithubModal);
els.githubModal.addEventListener('click', (e) => { if (e.target === els.githubModal) closeGithubModal(); });
els.ghConnect.addEventListener('click', connectGithub);
els.ghToken.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectGithub(); });
els.ghDisconnect.addEventListener('click', disconnectGithub);
els.ghRepoSearch.addEventListener('input', renderGhRepos);
els.ghRepoGo.addEventListener('click', ghRepoGoManual);
els.ghRepoSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') ghRepoGoManual(); });
els.ghBranch.addEventListener('change', () => loadGhTree(els.ghBranch.value));
els.ghFileSearch.addEventListener('input', () => renderGhFiles(false));
els.ghAttach.addEventListener('click', ghAttachSelected);
updateGithubBtn();
els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!streaming) send(); } });
els.main.addEventListener('scroll', () => { autoFollow = nearBottom(); els.scrollBtn.classList.toggle('hidden', autoFollow); });
els.scrollBtn.addEventListener('click', () => { autoFollow = true; scrollDown(true); });

els.settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
els.setClose.addEventListener('click', closeSettings);
els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) closeSettings(); });
els.sysPrompt.addEventListener('input', () => setSystem(els.sysPrompt.value));
els.pNumPredict.addEventListener('input', () => {
  const r = els.pNumPredict.value.trim();
  if (r === '') return setParam('num_predict', undefined);
  const n = parseInt(r, 10); setParam('num_predict', isFinite(n) ? n : undefined);
});
els.pSeed.addEventListener('input', () => {
  const r = els.pSeed.value.trim();
  if (r === '') return setParam('seed', undefined);
  const n = parseInt(r, 10); setParam('seed', isFinite(n) ? n : undefined);
});
els.pStop.addEventListener('input', () => {
  const arr = els.pStop.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  setParam('stop', arr.length ? arr : undefined);
});
els.setReset.addEventListener('click', resetSettings);
els.visualsToggle.addEventListener('change', () => { try { localStorage.setItem(VISUALS_KEY, els.visualsToggle.checked ? '1' : '0'); } catch (e) {} });
els.toolsToggle.addEventListener('change', () => { const c = toolsConfig(); c.enabled = els.toolsToggle.checked; setToolsConfig(c); renderToolList(); });

els.manageModelsBtn.addEventListener('click', (e) => { e.stopPropagation(); closeSettings(); openModelModal(); });
els.mmClose.addEventListener('click', closeModelModal);
els.modelModal.addEventListener('click', (e) => { if (e.target === els.modelModal) closeModelModal(); });
els.mmAdd.addEventListener('click', () => { addModel(els.mmInput.value); els.mmInput.value = ''; });
els.mmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { addModel(els.mmInput.value); els.mmInput.value = ''; } });
els.mmSearch.addEventListener('input', renderCatalog);

els.scaffoldBtn.addEventListener('click', (e) => { e.stopPropagation(); openScaffoldModal(); });
els.scClose.addEventListener('click', closeScaffoldModal);
els.scaffoldModal.addEventListener('click', (e) => { if (e.target === els.scaffoldModal) closeScaffoldModal(); });
els.scSearch.addEventListener('input', renderScaffoldList);
els.scNew.addEventListener('click', () => openBuilder(EMPTY_DRAFT, null));
els.sbClose.addEventListener('click', () => { closeBuilder(); openScaffoldModal(); });
els.sbCancel.addEventListener('click', () => { closeBuilder(); openScaffoldModal(); });
els.scaffoldBuilder.addEventListener('click', (e) => { if (e.target === els.scaffoldBuilder) { closeBuilder(); openScaffoldModal(); } });
els.sbSave.addEventListener('click', saveBuilder);
['sbName', 'sbSummary', 'sbRole', 'sbPerspective', 'sbTone', 'sbSteps', 'sbMust', 'sbNever', 'sbDisc', 'sbProh']
  .forEach((id) => els[id].addEventListener('input', updateBuilderPreview));

els.pjClose.addEventListener('click', closeProjectEditor);
els.pjCancel.addEventListener('click', closeProjectEditor);
els.projectModal.addEventListener('click', (e) => { if (e.target === els.projectModal) closeProjectEditor(); });
els.pjSave.addEventListener('click', saveProject);
els.pjDelete.addEventListener('click', () => { if (projectEditingId && confirm('Delete this project? Its chats are kept and moved to All chats.')) deleteProject(projectEditingId); });
els.pjUpload.addEventListener('change', async () => {
  for (const file of [...els.pjUpload.files]) {
    if (file.size > 200 * 1024) { alert('“' + file.name + '” is larger than 200 KB and was skipped.'); continue; }
    let text = ''; try { text = await file.text(); } catch (e) { continue; }
    projectDraft.files.push({ id: uidS(), name: file.name, content: text });
  }
  els.pjUpload.value = ''; renderProjectFiles();
});
els.pjPasteAdd.addEventListener('click', () => {
  const content = els.pjPaste.value; if (!content.trim()) return;
  const name = els.pjPasteName.value.trim() || ('note-' + (projectDraft.files.length + 1) + '.txt');
  projectDraft.files.push({ id: uidS(), name, content });
  els.pjPaste.value = ''; els.pjPasteName.value = ''; renderProjectFiles();
});

/* ---------- Boot ---------- */
(async function boot() {
  if (els.rememberKey) els.rememberKey.checked = rememberPref();
  if (apiKey) {
    const res = await validateKey(apiKey).catch(() => ({ ok: false }));
    if (res.ok) { await loadModels(); enterApp(); return; }
    clearKey(); apiKey = '';
  }
  showApp(false);
})();
