/* SEER · Mantic Think — chat app logic */
'use strict';

const KEY_STORE = 'mt_ollama_key';
const $ = (id) => document.getElementById(id);
const els = {
  gate: $('gate'), keyInput: $('keyInput'), gateErr: $('gateErr'), connect: $('connect'),
  app: $('app'), scrim: $('scrim'), sidebar: $('sidebar'), convList: $('convList'),
  newChat: $('newChat'), disconnect: $('disconnect'), menuBtn: $('menuBtn'),
  model: $('model'), headerTitle: $('headerTitle'),
  main: $('main'), thread: $('thread'), scrollBtn: $('scrollBtn'),
  input: $('input'), send: $('send'), err: $('err'),
  settingsBtn: $('settingsBtn'), settingsModal: $('settingsModal'), setClose: $('setClose'),
  paramSliders: $('paramSliders'), sysPrompt: $('sysPrompt'),
  pNumPredict: $('pNumPredict'), pSeed: $('pSeed'), pStop: $('pStop'), setReset: $('setReset'),
  visualsToggle: $('visualsToggle'),
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

let apiKey = localStorage.getItem(KEY_STORE) || '';
let current = null;              // active conversation { id, title, model, messages: [] }
let streaming = false;
let controller = null;
let autoFollow = true;

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
    const holder = document.createElement('div'); holder.className = 'chart-box';
    const canvas = document.createElement('canvas'); holder.appendChild(canvas);
    pre.replaceWith(holder);
    ensureChart().then((C) => { try { new C(canvas, cfg); maybeScroll(); } catch (e) { holder.className = 'diagram-err'; holder.textContent = 'Chart error: ' + ((e && e.message) || e); } })
      .catch(() => { holder.className = 'diagram-err'; holder.textContent = 'Chart failed to load.'; });
  });
}

function renderAssistantHTML(bubble, text) {
  bubble.classList.remove('plain');
  bubble.innerHTML = renderMarkdown(text);
  renderVisuals(bubble);
  bubble.querySelectorAll('pre code').forEach((el) => { try { window.hljs && hljs.highlightElement(el); } catch (e) {} });
  bubble.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn'; btn.type = 'button'; btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
      btn.textContent = 'Copied'; btn.classList.add('ok');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1200);
    });
    pre.appendChild(btn);
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
    idx.unshift({ id: conv.id, title: conv.title, model: conv.model, updatedAt: conv.updatedAt });
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
    if (res.ok) { apiKey = key; localStorage.setItem(KEY_STORE, key); await loadModels(); enterApp(); }
    else els.gateErr.textContent = res.error || 'That key was rejected.';
  } catch (e) { els.gateErr.textContent = 'Network error. Try again.'; }
  finally { els.connect.disabled = false; els.connect.textContent = 'Connect'; }
}
function disconnect() {
  apiKey = ''; localStorage.removeItem(KEY_STORE);
  current = null; els.keyInput.value = '';
  showApp(false);  // conversations are kept in storage
}
function enterApp() { showApp(true); openMostRecentOrNew(); renderSidebar(); }

/* ---------- Conversations ---------- */
function newConversation() {
  current = { id: uid(), title: 'New chat', model: els.model.value, messages: [], updatedAt: Date.now() };
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
  const list = store.list();
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

function addUserBubble(text) {
  const wrap = document.createElement('div'); wrap.className = 'msg user';
  const col = document.createElement('div'); col.className = 'col';
  const role = document.createElement('div'); role.className = 'role'; role.textContent = 'You';
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
  col.appendChild(role); col.appendChild(bubble); wrap.appendChild(col);
  els.thread.appendChild(wrap); scrollDown();
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
  if (m.content) { renderAssistantHTML(a.bubble, m.content); a.bubble.dataset.raw = m.content; }
  else a.bubble.textContent = '…';
  if (m.stats) a.setStats(m.stats);
  a.addActions();
}

function renderConversation() {
  els.thread.innerHTML = '';
  renderScaffoldBar();
  if (!current || current.messages.length === 0) { renderEmpty(); updateHeaderTitle(); return; }
  for (const m of current.messages) {
    if (m.role === 'user') addUserBubble(m.content);
    else if (m.role === 'assistant') renderAssistantMessage(m);
  }
  updateHeaderTitle(); autoFollow = true; scrollDown(true);
}

function renderSidebar() {
  const list = store.list();
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
  let acc = '', accThink = '', stats = null, firstTok = false, sawContent = false, failed = false;
  try {
    const reqMsgs = [];
    const scaf = activeScaffold();
    if (scaf) { reqMsgs.push({ role: 'system', content: compileScaffold(scaf) }); touchScaffold(scaf.id); }
    if (visualsOn()) reqMsgs.push({ role: 'system', content: VISUALS_HINT });
    const sys = effectiveSystem().trim();
    if (sys) reqMsgs.push({ role: 'system', content: sys });
    for (const m of current.messages) reqMsgs.push({ role: m.role, content: m.content });
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ model: els.model.value, messages: reqMsgs, options: buildOptions() }),
      signal: controller.signal,
    });
    if (resp.status === 401) { disconnect(); throw new Error('Your key was rejected — please reconnect.'); }
    if (!resp.ok || !resp.body) { const d = await resp.text().catch(() => ''); throw new Error('Request failed (' + resp.status + ') ' + d.slice(0, 160)); }
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
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
          acc += msg.content; a.bubble.textContent = acc; a.bubble.classList.add('cursor'); maybeScroll();
        }
        if (obj.done) stats = { eval_count: obj.eval_count, eval_duration: obj.eval_duration };
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') { failed = true; showErr(e.message || 'Something went wrong.'); }
  }

  setStreaming(false); controller = null;
  a.clearTyping(); a.bubble.classList.remove('cursor');

  if (failed && !acc && !accThink) { a.wrap.remove(); return; }

  if (acc) { renderAssistantHTML(a.bubble, acc); a.bubble.dataset.raw = acc; }
  else if (!accThink) { a.bubble.textContent = '…'; }
  a.collapseThinking();
  if (stats) a.setStats(stats);
  a.addActions();

  current.messages.push({ role: 'assistant', content: acc, thinking: accThink || undefined, stats: stats || undefined });
  if (current.title === 'New chat') {
    const fu = current.messages.find((m) => m.role === 'user');
    if (fu) current.title = (fu.content.slice(0, 42).trim() || 'New chat');
  }
  store.save(current); renderSidebar(); updateHeaderTitle(); maybeScroll(true);
}

async function send() {
  const text = els.input.value.trim();
  if (!text || streaming) return;
  showErr('');
  els.input.value = ''; autosize();
  if (!current) newConversation();
  removeEmptyState();
  current.messages.push({ role: 'user', content: text });
  addUserBubble(text);
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

/* ---------- Boot ---------- */
(async function boot() {
  if (apiKey) {
    const res = await validateKey(apiKey).catch(() => ({ ok: false }));
    if (res.ok) { await loadModels(); enterApp(); return; }
    localStorage.removeItem(KEY_STORE); apiKey = '';
  }
  showApp(false);
})();
