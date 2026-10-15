// AgroLineAge shared-state rules engine. Pure functions, no I/O, no dependencies:
// runs unchanged inside a Durable Object and under `node --test`.
// Keeps the existing app schema (orgs / farmers / animals / acts) and adds server-managed
// metadata on each record: _rev, _fr (per-field revision), _cat/_cby, _uat/_uby, _del.

export const SCHEMA_VERSION = 3;
export const COLLECTIONS = ['orgs', 'farmers', 'animals', 'acts'];
export const STATUSES = ['Alive', 'Sold', 'Deceased'];
export const ACT_TYPES = ['Vaccination', 'Deworming', 'Treatment', 'Vet check-up', 'Breeding', 'Birth / offspring', 'Weighing', 'Feeding', 'Insurance claim', 'Sold', 'Mortality', 'Other'];

export class CommitError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const bad = (m, d) => new CommitError(400, 'invalid', m, d);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const S = max => v => typeof v === 'string' && v.length <= max;
const ID = v => typeof v === 'string' && ID_RE.test(v);
const OPT_ID = v => v === '' || ID(v);
const DATE = v => v === '' || (typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')));
const ENUM = a => v => a.includes(v);
const NUM = v => v === '' || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const ATT_KEYS = ['id', 'name', 'type', 'size', 'dr'];
const ATT = v => Array.isArray(v) && v.length <= 50 && v.every(m => m && typeof m === 'object' && ID(m.id) && S(255)(m.name) && S(120)(m.type) &&
  Number.isFinite(m.size) && m.size >= 0 && Object.keys(m).every(k => ATT_KEYS.includes(k)) &&
  (m.dr === undefined || (m.dr && typeof m.dr === 'object' && S(200)(m.dr.id) && (m.dr.link === undefined || /^https:\/\/[^\s"'<>]{1,490}$/.test(m.dr.link)))));

const OWNERS = v => Array.isArray(v) && v.length <= 50 && v.every(e => e && typeof e === 'object' && Object.keys(e).every(k => ['farmer', 'from', 'to', 'note'].includes(k)) && ID(e.farmer) && DATE(e.from ?? '') && DATE(e.to ?? '') && S(200)(e.note ?? ''));
// field -> [validator, required, default]
const SPEC = {
  orgs: { name: [S(120), 1], color: [v => COLOR_RE.test(v), 0, '#8a8f8c'], location: [S(200), 0, ''], notes: [S(4000), 0, ''] },
  farmers: { name: [S(120), 1], org: [ID, 1], farm: [S(200), 0, ''], phone: [S(60), 0, ''], location: [S(200), 0, ''], notes: [S(4000), 0, ''] },
  animals: { tag: [S(60), 1], species: [S(60), 1], breed: [S(80), 0, ''], sex: [ENUM(['', 'F', 'M']), 0, ''], born: [DATE, 0, ''], status: [ENUM(STATUSES), 0, 'Alive'],
    owner: [ID, 1], parent: [OPT_ID, 0, ''], insured: [ENUM(['', 'No', 'Yes']), 0, 'No'], insurer: [S(120), 0, ''], insOther: [S(120), 0, ''], policy: [S(80), 0, ''],
    covStart: [DATE, 0, ''], covEnd: [DATE, 0, ''], notes: [S(4000), 0, ''], att: [ATT, 0, []],
    parentOwner: [OPT_ID, 0, ''], owners: [OWNERS, 0, []] },
  acts: { animal: [ID, 1], date: [DATE, 1], type: [ENUM(ACT_TYPES), 0, 'Other'], title: [S(200), 0, ''], notes: [S(4000), 0, ''], by: [S(120), 0, ''], cost: [NUM, 0, ''], next: [DATE, 0, ''], att: [ATT, 0, []] },
};
export const fieldsOf = coll => Object.keys(SPEC[coll]);

export const emptyState = () => ({ v: 2, schemaVersion: SCHEMA_VERSION, rev: 0, updatedAt: null, updatedBy: null, orgs: [], farmers: [], animals: [], acts: [] });
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkFields(coll, obj, partial, allowOwners = false) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('Record data must be an object');
  const spec = SPEC[coll], out = {};
  for (const k of Object.keys(obj)) if (!(k in spec) || (k === 'owners' && !allowOwners)) throw bad(`Field "${k}" is not allowed`, { field: k }); // blocks mass assignment (_rev, role, updatedBy…); ownership history changes only through 'transfer'
  for (const [k, [chk, req, def]] of Object.entries(spec)) {
    if (!(k in obj)) { if (partial) continue; if (req) throw bad(`"${k}" is required`, { field: k }); out[k] = structuredClone(def); continue; }
    const v = obj[k];
    if (!chk(v) || (req && typeof v === 'string' && !v.trim())) throw bad(`"${k}" is invalid`, { field: k });
    out[k] = structuredClone(v);
  }
  return out;
}

// Cross-record rules. Returns stable, human-readable violation strings.
export function violations(st) {
  const out = [], live = c => st[c].filter(r => !r._del);
  const O = new Map(live('orgs').map(r => [r.id, r])), F = new Map(live('farmers').map(r => [r.id, r])), A = new Map(live('animals').map(r => [r.id, r]));
  const uniq = (rows, key, label) => { const seen = new Set(); for (const r of rows) { const k = key(r); if (!k) continue; if (seen.has(k)) out.push(`duplicate ${label}: ${k}`); seen.add(k); } };
  uniq(live('orgs'), r => norm(r.name) && 'org:' + norm(r.name), 'organization name');
  uniq(live('farmers'), r => norm(r.name) && r.org + '|' + norm(r.name), 'farmer name in organization');
  uniq(live('animals'), r => F.get(r.owner) && norm(r.tag) && F.get(r.owner).org + '|' + norm(r.tag), 'animal tag in organization');
  for (const f of F.values()) if (!O.has(f.org)) out.push(`farmer ${f.id}: unknown or deleted organization`);
  for (const a of A.values()) {
    if (!F.has(a.owner)) out.push(`animal ${a.id}: unknown or deleted owner`);
    if (a.parent) {
      const p = A.get(a.parent);
      if (a.parent === a.id) out.push(`animal ${a.id}: cannot be its own parent`);
      else if (!p) out.push(`animal ${a.id}: unknown or deleted parent`);
      else if (p.born && a.born && a.born < p.born) out.push(`animal ${a.id}: born before its parent`);
    }
    if (a.covStart && a.covEnd && a.covEnd < a.covStart) out.push(`animal ${a.id}: coverage ends before it starts`);
    const seen = new Set([a.id]); let p = A.get(a.parent);
    while (p && p.id !== a.id) { if (seen.has(p.id)) break; seen.add(p.id); p = A.get(p.parent); }
    if (p && p.id === a.id && a.parent !== a.id) out.push(`animal ${a.id}: lineage cycle`);
  }
  for (const x of live('acts')) if (!A.has(x.animal)) out.push(`activity ${x.id}: unknown or deleted animal`);
  return out;
}

// ---- ownership history helpers (shared by server and UI) ----
/** Who held the animal on `date` (YYYY-MM-DD). Falls back to the current owner when history or date is unknown. */
export function ownerAt(a, date) {
  const h = a._owners || [];
  if (!h.length || !date) return a.owner;
  const hit = h.filter(e => (!e.from || e.from <= date) && (!e.to || date < e.to)).pop();
  if (hit) return hit.farmer;
  return h[0].from && date < h[0].from ? h[0].farmer : a.owner;
}
export const heldBy = (a, fid) => a.owner === fid || (a._owners || []).some(e => e.farmer === fid);
/** The farmer who held the parent when this animal was born (stored in parentOwner; derived for older records). */
export function effectiveParentOwner(st, a) {
  if (a.parentOwner) return a.parentOwner;
  const p = a.parent && st.animals.find(x => x.id === a.parent && !x._del);
  return p ? ownerAt(p, a.born) : '';
}
/** Family tree as one farmer sees it: animals they hold now ("current") or held before ("former", with who received it). A transferred mother appears here with the offspring born while this farmer held her. */
export function orgTree(st, farmerId) {
  const live = st.animals.filter(a => !a._del), mine = live.filter(a => heldBy(a, farmerId)), mineIds = new Set(mine.map(a => a.id));
  const kids = new Map(), isKid = new Set();
  for (const k of mine) {
    if (!k.parent || !mineIds.has(k.parent) || effectiveParentOwner(st, k) !== farmerId) continue;
    (kids.get(k.parent) || kids.set(k.parent, []).get(k.parent)).push(k); isKid.add(k.id);
  }
  const node = (a, seen) => {
    const h = a._owners || [], i = h.map(e => e.farmer).lastIndexOf(farmerId), e = i >= 0 ? h[i] : null, role = a.owner === farmerId ? 'current' : 'former';
    return { id: a.id, role, transferredTo: role === 'former' && e ? (h[i + 1] || {}).farmer || a.owner : null, transferredOn: role === 'former' && e ? e.to || '' : null,
      kids: (kids.get(a.id) || []).filter(k => !seen.has(k.id)).sort((x, y) => (x.born || '').localeCompare(y.born || '')).map(k => node(k, new Set([...seen, k.id]))) };
  };
  return mine.filter(a => !isKid.has(a.id)).map(a => node(a, new Set([a.id])));
}
/** Offspring of one animal grouped by who held the mother at birth, in ownership order: [{farmer, offspring:[ids]}]. */
export function offspringByOwner(st, animalId) {
  const a = st.animals.find(x => x.id === animalId), groups = new Map();
  if (!a) return [];
  for (const e of a._owners || []) if (!groups.has(e.farmer)) groups.set(e.farmer, []);
  for (const k of st.animals.filter(x => x.parent === animalId && !x._del).sort((x, y) => (x.born || '').localeCompare(y.born || ''))) {
    const f = effectiveParentOwner(st, k) || a.owner; (groups.get(f) || groups.set(f, []).get(f)).push(k.id);
  }
  return [...groups].map(([farmer, offspring]) => ({ farmer, offspring }));
}

const OP_KINDS = ['create', 'update', 'delete', 'restore', 'transfer'];

/**
 * Atomically apply a batch of operations.
 * ops: [{kind, coll, id, record?, patch?, baseRev?, force?}]; ctx: {actor:{id,displayName,role}, opId, now?, newId?, policy?, maxOps?}
 * idem: Map-like {get,set} of previous results (idempotency). Returns {ok, state, rev, events, results} or {ok:false,status,error,message,details}.
 * Never mutates `state`.
 */
export function commit(state, ops, ctx, idem) {
  try {
    const { actor, opId, now = new Date().toISOString(), newId = () => crypto.randomUUID(), policy = {}, maxOps = 500 } = ctx || {};
    if (!actor || !['admin', 'editor', 'viewer'].includes(actor.role)) throw new CommitError(403, 'forbidden', 'Not allowed');
    if (actor.role === 'viewer') throw new CommitError(403, 'forbidden', 'Viewers cannot change data');
    if (typeof opId !== 'string' || opId.length < 8 || opId.length > 100) throw bad('An idempotency key (opId) of 8–100 characters is required');
    if (!Array.isArray(ops) || !ops.length || ops.length > maxOps) throw bad(`Send between 1 and ${maxOps} operations`);
    const key = actor.id + ':' + opId, hit = idem && idem.get(key);
    if (hit) return { ok: true, replay: true, state, rev: hit.rev, events: [], results: hit.results };

    const before = new Set(violations(state)), st = structuredClone(state);
    const idx = Object.fromEntries(COLLECTIONS.map(c => [c, new Map(st[c].map(r => [r.id, r]))]));
    const events = [], results = [], who = { id: actor.id, displayName: actor.displayName || actor.id };
    const emit = (type, coll, rec, rev, changes) => events.push({ eventId: newId(), type, recordType: coll, recordId: rec.id, revision: rev, actor: who, timestamp: now, changes });
    const touch = (rec, rev) => { rec._rev = rev; rec._uat = now; rec._uby = actor.id; };

    for (const op of ops) {
      if (!op || !OP_KINDS.includes(op.kind) || !COLLECTIONS.includes(op.coll) || !ID(op.id)) throw bad('Malformed operation');
      if (op.force && actor.role !== 'admin') throw new CommitError(403, 'forbidden', 'Only administrators can force an operation');
      if (op.kind === 'delete') {
        if (actor.role !== 'admin' && (op.coll === 'orgs' || policy.editorDelete === false)) throw new CommitError(403, 'forbidden', 'Your role cannot delete this kind of record');
      }
      const rec = idx[op.coll].get(op.id), rev = st.rev + 1;
      if (op.kind === 'create') {
        if (rec) throw new CommitError(409, 'exists', `${op.coll} ${op.id} already exists`, { coll: op.coll, id: op.id });
        const f = checkFields(op.coll, op.record, false, ctx.allowOwners === true);
        let own;
        if (op.coll === 'animals') {
          own = f.owners; delete f.owners;
          if (f.parent && !f.parentOwner) { const p = idx.animals.get(f.parent); if (p) f.parentOwner = ownerAt(p, f.born); }
          if (f.parentOwner && !idx.farmers.has(f.parentOwner)) throw bad('"parentOwner" is not a known farmer', { field: 'parentOwner' });
        }
        const nr = { id: op.id, ...f, _rev: rev, _fr: Object.fromEntries(Object.keys(f).map(k => [k, rev])), _cat: now, _cby: actor.id, _uat: now, _uby: actor.id };
        if (op.coll === 'animals') nr._owners = own && own.length ? own : [{ farmer: f.owner, from: f.born || '', to: '', note: '' }];
        st[op.coll].push(nr); idx[op.coll].set(op.id, nr); st.rev = rev;
        emit('record.created', op.coll, nr, rev, structuredClone(f)); results.push({ coll: op.coll, id: op.id, rev });
        continue;
      }
      if (!rec) throw new CommitError(404, 'not_found', `${op.coll} ${op.id} not found`, { coll: op.coll, id: op.id });
      if (op.kind === 'transfer') {
        if (op.coll !== 'animals') throw bad('Only animals can be transferred');
        if (rec._del) throw new CommitError(409, 'deleted', 'This animal was deleted', { coll: op.coll, id: op.id });
        if (!Number.isInteger(op.baseRev)) throw bad('baseRev is required for transfers');
        if ((rec._fr.owner || 0) > op.baseRev) throw new CommitError(409, 'conflict', 'The owner was changed by someone else; review before transferring', { coll: op.coll, id: op.id, fields: ['owner'], current: rec });
        const to = idx.farmers.get(op.toFarmer);
        if (!to || to._del) throw bad('The receiving farmer does not exist', { field: 'toFarmer' });
        if (op.toFarmer === rec.owner) throw bad('This animal already belongs to that farmer', { field: 'toFarmer' });
        if (typeof op.date !== 'string' || !op.date || !DATE(op.date)) throw bad('A valid transfer date is required', { field: 'date' });
        if (!S(200)(op.note ?? '')) throw bad('Note is too long', { field: 'note' });
        const h = rec._owners || (rec._owners = []), last = h[h.length - 1];
        if (last && last.from && op.date < last.from) throw bad('Transfer date is earlier than the previous transfer', { field: 'date' });
        if (rec.born && op.date < rec.born) throw bad('Transfer date is before the animal was born', { field: 'date' });
        const prev = rec.owner;
        st.rev = rev; if (last && !last.to) last.to = op.date;
        h.push({ farmer: op.toFarmer, from: op.date, to: '', note: op.note || '' }); rec.owner = op.toFarmer; rec._fr.owner = rev; touch(rec, rev);
        emit('record.transferred', op.coll, rec, rev, { owner: rec.owner, owners: structuredClone(h), transfer: { from: prev, to: op.toFarmer, date: op.date, note: op.note || '' } });
        results.push({ coll: op.coll, id: op.id, rev }); continue;
      }
      if (op.kind === 'update') {
        if (rec._del) throw new CommitError(409, 'deleted', 'This record was deleted by someone else', { coll: op.coll, id: op.id, current: rec });
        if (!Number.isInteger(op.baseRev)) throw bad('baseRev is required for updates');
        const patch = checkFields(op.coll, op.patch, true), changed = {}, conflicts = [];
        if (op.coll === 'animals' && patch.parentOwner && !idx.farmers.has(patch.parentOwner)) throw bad('"parentOwner" is not a known farmer', { field: 'parentOwner' });
        for (const [k, v] of Object.entries(patch)) {
          if (same(rec[k], v)) continue;
          if ((rec._fr[k] || 0) > op.baseRev) conflicts.push(k); else changed[k] = v;
        }
        if (conflicts.length) throw new CommitError(409, 'conflict', 'Someone else changed the same field(s)', { coll: op.coll, id: op.id, fields: conflicts, current: rec });
        if (!Object.keys(changed).length) { results.push({ coll: op.coll, id: op.id, rev: rec._rev, unchanged: true }); continue; }
        st.rev = rev; for (const [k, v] of Object.entries(changed)) { rec[k] = v; rec._fr[k] = rev; }
        if (op.coll === 'animals') {
          if ('owner' in changed) { // direct owner edit = correction of the current holder (use 'transfer' to record a hand-over)
            const h = rec._owners || (rec._owners = []), l = h[h.length - 1];
            if (l && !l.to) l.farmer = changed.owner; else h.push({ farmer: changed.owner, from: '', to: '', note: '' });
            changed.owners = structuredClone(h);
          }
          if ('parent' in changed && !('parentOwner' in patch)) { const p = idx.animals.get(changed.parent); rec.parentOwner = p ? ownerAt(p, rec.born) : ''; rec._fr.parentOwner = rev; changed.parentOwner = rec.parentOwner; }
        }
        touch(rec, rev);
        emit('record.updated', op.coll, rec, rev, changed); results.push({ coll: op.coll, id: op.id, rev });
      } else if (op.kind === 'delete') {
        if (rec._del) { results.push({ coll: op.coll, id: op.id, rev: rec._rev, unchanged: true }); continue; }
        if (!op.force) {
          if (!Number.isInteger(op.baseRev)) throw bad('baseRev is required for deletes');
          if (rec._rev > op.baseRev) throw new CommitError(409, 'edited_since', 'This record was edited after you loaded it; review before deleting', { coll: op.coll, id: op.id, current: rec });
        }
        st.rev = rev; rec._del = { at: now, by: actor.id }; touch(rec, rev);
        emit('record.deleted', op.coll, rec, rev, {}); results.push({ coll: op.coll, id: op.id, rev });
      } else { // restore
        if (!rec._del) { results.push({ coll: op.coll, id: op.id, rev: rec._rev, unchanged: true }); continue; }
        st.rev = rev; delete rec._del; touch(rec, rev);
        emit('record.restored', op.coll, rec, rev, {}); results.push({ coll: op.coll, id: op.id, rev });
      }
    }
    const added = violations(st).filter(m => !before.has(m)); // only NEW problems block a save, so legacy quirks never lock editors out
    if (added.length) throw new CommitError(422, 'integrity', 'This change would break data integrity', { violations: added });
    if (events.length) { st.updatedAt = now; st.updatedBy = actor.id; }
    const res = { rev: st.rev, results };
    if (idem) idem.set(key, res);
    return { ok: true, state: events.length ? st : state, ...res, events };
  } catch (e) {
    if (e instanceof CommitError) return { ok: false, status: e.status, error: e.code, message: e.message, details: e.details };
    throw e;
  }
}

/** Export in the legacy app format ({v:2, orgs, farmers, animals, acts, pos, upd}) — usable as a JSON backup AND as the rollback file for the old app. */
export function toLegacyJson(state, { includeDeleted = false } = {}) {
  const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
  const pick = c => state[c].filter(r => includeDeleted || !r._del).map(strip);
  const animals = state.animals.filter(r => includeDeleted || !r._del).map(r => ({ ...strip(r), owners: structuredClone(r._owners || []) })); // history rides along so backups keep it
  return { v: 2, orgs: pick('orgs'), farmers: pick('farmers'), animals, acts: pick('acts'), pos: {}, upd: Date.parse(state.updatedAt || '') || 0 };
}

/**
 * Import legacy app JSON (Drive file / localStorage "lt2"). Keeps IDs. Idempotent: records whose ID already exists are skipped.
 * dryRun validates and reports without returning a changed state. Requires an admin actor.
 */
export function importLegacy(state, legacy, ctx, { dryRun = false } = {}) {
  const report = { dryRun, counts: {}, warnings: [], errors: [], verified: false };
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) { report.errors.push('File is not a JSON object'); return { ok: false, report }; }
  if (!ctx.actor || ctx.actor.role !== 'admin') { report.errors.push('Only administrators can import'); return { ok: false, report }; }
  const src = Object.fromEntries(COLLECTIONS.map(c => [c, Array.isArray(legacy[c]) ? legacy[c] : []]));
  if (!src.orgs.length && src.farmers.length) { src.orgs.push({ id: 'O-default', name: 'My organization' }); report.warnings.push('Old single-organization data: created organization "My organization"'); }
  const orgIds = new Set(src.orgs.map(o => o && o.id)), dropped = {}, ops = [], valid = Object.fromEntries(COLLECTIONS.map(c => [c, []]));
  for (const c of COLLECTIONS) {
    const seen = new Set(); report.counts[c] = { source: src[c].length, created: 0, skipped: 0, invalid: 0 };
    src[c].forEach((r, i) => {
      if (!r || typeof r !== 'object' || !ID(r.id)) { report.errors.push(`${c} #${i + 1}: missing or invalid id`); report.counts[c].invalid++; return; }
      if (seen.has(r.id)) { report.errors.push(`${c}: duplicate id ${r.id}`); report.counts[c].invalid++; return; }
      seen.add(r.id);
      const allowed = fieldsOf(c), rec = {};
      for (const [k, v] of Object.entries(r)) { if (k === 'id') continue; if (allowed.includes(k)) rec[k] = v; else { const key = c + '.' + k; dropped[key] = (dropped[key] || 0) + 1; } }
      if (c === 'orgs' && !rec.color) delete rec.color;
      if (c === 'farmers' && !orgIds.has(rec.org) && src.orgs.length) { report.warnings.push(`farmer ${r.id}: unknown organization, moved to "${src.orgs[0].name}"`); rec.org = src.orgs[0].id; }
      if (c === 'animals') { rec.status = rec.status || 'Alive'; rec.insured = rec.insured ?? 'No'; rec.parent = rec.parent || ''; rec.att = rec.att || []; }
      if (c === 'acts') rec.att = rec.att || [];
      valid[c].push(r.id);
      const ex = [...(state[c] || [])].find(x => x.id === r.id);
      if (ex) {
        report.counts[c].skipped++;
        if (!same(Object.fromEntries(allowed.filter(k => k !== 'owners' && k in rec).map(k => [k, rec[k]])), Object.fromEntries(allowed.filter(k => k !== 'owners' && k in rec).map(k => [k, ex[k]])))) report.warnings.push(`${c} ${r.id} already exists with different content; server copy kept`);
      } else { report.counts[c].created++; ops.push({ kind: 'create', coll: c, id: r.id, record: rec }); }
    });
  }
  for (const [k, n] of Object.entries(dropped)) report.warnings.push(`Ignored unknown field "${k}" on ${n} record(s)`);
  if (report.errors.length) return { ok: false, report };
  if (!ops.length) { report.verified = true; return { ok: true, report, state }; }
  const r = commit(state, ops, { ...ctx, maxOps: 1e6, allowOwners: true }, new Map());
  if (!r.ok) { report.errors.push(r.message); (r.details?.violations || []).forEach(v => report.errors.push(v)); if (r.details?.field) report.errors.push(`field: ${r.details.field}`); return { ok: false, report }; }
  report.verified = COLLECTIONS.every(c => valid[c].every(id => r.state[c].some(x => x.id === id)));
  return { ok: true, report, state: dryRun ? state : r.state, events: dryRun ? [] : r.events };
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
