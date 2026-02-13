import { clear, get, getAll, put, remove } from './db.js';

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

export async function createModelVersionKey(model) {
  const shardIdentity = (model.shards || [])
    .map((shard) => `${shard.url}|${shard.sha256 || 'dev'}`)
    .join('||');
  return sha256(`${model.id}|${model.revision || '0'}|${shardIdentity}`);
}

export function makeShardCacheId(modelId, versionKey, shardIndex) {
  return `${modelId}:${versionKey}:${shardIndex}`;
}

export async function cacheModelShard({ modelId, versionKey, shardIndex, shardUrl, sha256: checksum, data }) {
  const id = makeShardCacheId(modelId, versionKey, shardIndex);
  await put('modelCache', {
    id,
    modelId,
    versionKey,
    shardIndex,
    shardUrl,
    sha256: checksum || 'dev',
    sizeBytes: data.byteLength,
    data,
    updatedAt: Date.now()
  });
}

export async function getCachedModelShard({ modelId, versionKey, shardIndex }) {
  return get('modelCache', makeShardCacheId(modelId, versionKey, shardIndex));
}

export async function putModelManifest(model, versionKey) {
  await put('modelManifests', {
    id: model.id,
    versionKey,
    revision: model.revision || null,
    shardCount: model.shards?.length || 0,
    updatedAt: Date.now(),
    model
  });
}

export async function getModelManifest(modelId) {
  return get('modelManifests', modelId);
}

export async function listCachedModels() {
  return getAll('modelManifests');
}

export async function deleteModelCache(modelId) {
  const [allShards, modelManifest] = await Promise.all([getAll('modelCache'), get('modelManifests', modelId)]);
  const entries = allShards.filter((item) => item.modelId === modelId);
  await Promise.all(entries.map((item) => remove('modelCache', item.id)));
  if (modelManifest) {
    await remove('modelManifests', modelId);
  }
}

export async function deleteStaleModelVersions(modelId, activeVersionKey) {
  const allShards = await getAll('modelCache');
  const staleEntries = allShards.filter((item) => item.modelId === modelId && item.versionKey !== activeVersionKey);
  await Promise.all(staleEntries.map((item) => remove('modelCache', item.id)));
}

export async function invalidateChangedModels(currentManifestModels) {
  const cachedManifests = await listCachedModels();

  for (const model of currentManifestModels) {
    const newKey = await createModelVersionKey(model);
    const existing = cachedManifests.find((cached) => cached.id === model.id);
    if (existing && existing.versionKey !== newKey) {
      await deleteModelCache(model.id);
    }
  }
}

export async function getModelCacheUsage() {
  const [cacheRows, manifests] = await Promise.all([getAll('modelCache'), getAll('modelManifests')]);
  const bytes = cacheRows.reduce((sum, row) => sum + (row.sizeBytes || row.data?.byteLength || 0), 0);
  return {
    bytes,
    models: manifests.map((entry) => ({ modelId: entry.id, versionKey: entry.versionKey, updatedAt: entry.updatedAt })),
    shardCount: cacheRows.length
  };
}

export async function clearAllModelCache() {
  await Promise.all([clear('modelCache'), clear('modelManifests')]);
}
