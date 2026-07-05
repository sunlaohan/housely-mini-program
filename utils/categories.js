const { KEYS, read, write } = require('./storage');

const DEFAULT_CATEGORY_ID = 'default';
const DEFAULT_CATEGORY_NAME = '默认分类';

function categoriesCollection() {
  return wx.cloud.database().collection('categories');
}

function docsCollection() {
  return wx.cloud.database().collection('documents');
}

function isMissingCollectionError(error) {
  const text = `${(error && error.errMsg) || ''}${(error && error.message) || ''}`;
  return text.includes('collection') && (text.includes('does not exist') || text.includes('不存在'));
}

function getOwnerInfo(user) {
  return {
    ownerKey: String((user && user.username) || '').trim(),
    legacyUserId: String((user && user.id) || '').trim()
  };
}

function getCategoryStorageKey(user) {
  const ownerKey = String(user && (user.username || user.id || user._id) || 'guest').trim() || 'guest';
  return `${KEYS.CATEGORIES_PREFIX}${ownerKey}`;
}

function getDefaultCategory() {
  return {
    id: DEFAULT_CATEGORY_ID,
    name: DEFAULT_CATEGORY_NAME,
    isDefault: true,
    swipeOffset: 0,
    editing: false,
    draftName: DEFAULT_CATEGORY_NAME,
    focus: false
  };
}

function normalizeCategory(category) {
  const id = String(category && (category.categoryId || category.id || category._id) || '').trim();
  const name = String(category && category.name || '').trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    cloudId: String(category && category._id || '').trim(),
    name,
    ownerKey: String(category && (category.ownerKey || category.username || category.userId) || '').trim(),
    userId: String(category && category.userId || '').trim(),
    isDefault: id === DEFAULT_CATEGORY_ID || Boolean(category && category.isDefault),
    sort: Number(category && category.sort || 0) || 0,
    createdAt: category && category.createdAt,
    updatedAt: category && category.updatedAt,
    swipeOffset: 0,
    editing: false,
    draftName: name,
    focus: false
  };
}

function normalizeCategories(categories = []) {
  const seenNames = new Set();
  const normalized = (Array.isArray(categories) ? categories : [])
    .map(normalizeCategory)
    .filter(Boolean)
    .filter((category) => category.id !== DEFAULT_CATEGORY_ID)
    .filter((category) => {
      if (seenNames.has(category.name)) {
        return false;
      }

      seenNames.add(category.name);
      return true;
    })
    .sort((left, right) => {
      if (left.sort !== right.sort) {
        return right.sort - left.sort;
      }

      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });

  return [getDefaultCategory()].concat(normalized);
}

function getLocalCategories(user) {
  return normalizeCategories(read(getCategoryStorageKey(user), []));
}

function saveLocalCategories(user, categories) {
  const customCategories = normalizeCategories(categories)
    .filter((category) => category.id !== DEFAULT_CATEGORY_ID)
    .map((category) => ({
      id: category.id,
      cloudId: category.cloudId || '',
      name: category.name,
      sort: category.sort || 0,
      createdAt: category.createdAt || ''
    }));

  write(getCategoryStorageKey(user), customCategories);
  return normalizeCategories(customCategories);
}

function clearLocalCategories(user) {
  write(getCategoryStorageKey(user), []);
}

async function runSafeQuery(query) {
  try {
    return await query.get();
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return { data: [] };
    }
    throw error;
  }
}

async function queryCloudCategories(user) {
  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  const queries = [];

  if (ownerKey) {
    queries.push(runSafeQuery(categoriesCollection().where({ ownerKey })));
    queries.push(runSafeQuery(categoriesCollection().where({ username: ownerKey })));
  }

  if (legacyUserId) {
    queries.push(runSafeQuery(categoriesCollection().where({ userId: legacyUserId })));
  }

  if (!queries.length) {
    return [];
  }

  const results = await Promise.all(queries);
  const categoryMap = new Map();
  results.forEach((result) => {
    (result.data || []).forEach((category) => {
      const normalized = normalizeCategory(category);
      if (normalized && normalized.id !== DEFAULT_CATEGORY_ID) {
        categoryMap.set(normalized.id, normalized);
      }
    });
  });

  return Array.from(categoryMap.values());
}

async function getCategories(user) {
  const localCategories = getLocalCategories(user);

  try {
    const cloudCategories = await queryCloudCategories(user);
    return saveLocalCategories(user, cloudCategories);
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return saveLocalCategories(user, []);
    }

    console.error('getCategories failed, fallback local', error);
    return localCategories;
  }
}

async function createCategory(user, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return getCategories(user);
  }

  const categories = await getCategories(user);
  const exists = categories.some((category) => category.name === trimmedName);
  if (exists) {
    return categories;
  }

  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  const now = new Date();
  const sort = now.getTime();
  const categoryId = `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    ownerKey,
    username: ownerKey,
    userId: legacyUserId,
    categoryId,
    name: trimmedName,
    sort,
    createdAt: now,
    updatedAt: now
  };

  try {
    const result = await categoriesCollection().add({ data: payload });
    return saveLocalCategories(user, categories.concat(normalizeCategory({
      _id: result._id,
      ...payload
    })));
  } catch (error) {
    throw error;
  }
}

async function updateCategory(user, categoryId, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName || categoryId === DEFAULT_CATEGORY_ID) {
    return getCategories(user);
  }

  const categories = await getCategories(user);
  const category = categories.find((item) => item.id === categoryId);
  if (!category || category.isDefault) {
    return categories;
  }

  try {
    if (category.cloudId) {
      await categoriesCollection().doc(category.cloudId).update({
        data: {
          name: trimmedName,
          updatedAt: new Date()
        }
      });
    }
    await updateBoundDocumentsCategoryName(user, categoryId, trimmedName);
  } catch (error) {
    throw error;
  }

  return saveLocalCategories(user, categories.map((item) =>
    item.id === categoryId
      ? { ...item, name: trimmedName, updatedAt: new Date() }
      : item
  ));
}

async function deleteCategory(user, categoryId) {
  if (!categoryId || categoryId === DEFAULT_CATEGORY_ID) {
    return getCategories(user);
  }

  const categories = await getCategories(user);
  const category = categories.find((item) => item.id === categoryId);
  try {
    if (category && category.cloudId) {
      await categoriesCollection().doc(category.cloudId).remove();
    }
    await resetBoundDocumentsCategory(user, categoryId);
  } catch (error) {
    throw error;
  }

  return saveLocalCategories(user, categories.filter((category) => category.id !== categoryId));
}

async function getCategoryById(user, categoryId) {
  const categories = await getCategories(user);
  return categories.find((category) => category.id === categoryId) || categories[0] || getDefaultCategory();
}

function getCategoryByIdFromList(categories, categoryId) {
  const normalizedCategories = normalizeCategories(categories);
  return normalizedCategories.find((category) => category.id === categoryId) || normalizedCategories[0] || getDefaultCategory();
}

async function queryBoundDocuments(user, categoryId) {
  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  const queries = [];

  if (ownerKey) {
    queries.push(runSafeQuery(docsCollection().where({ ownerKey, categoryId })));
    queries.push(runSafeQuery(docsCollection().where({ username: ownerKey, categoryId })));
  }

  if (legacyUserId) {
    queries.push(runSafeQuery(docsCollection().where({ userId: legacyUserId, categoryId })));
  }

  const results = await Promise.all(queries);
  const docMap = new Map();
  results.forEach((result) => {
    (result.data || []).forEach((doc) => {
      if (doc && doc._id) {
        docMap.set(doc._id, doc);
      }
    });
  });

  return Array.from(docMap.values());
}

async function updateBoundDocumentsCategoryName(user, categoryId, categoryName) {
  const docs = await queryBoundDocuments(user, categoryId);
  await Promise.all(docs.map((doc) =>
    docsCollection().doc(doc._id).update({
      data: {
        categoryName
      }
    })
  ));
}

async function resetBoundDocumentsCategory(user, categoryId) {
  const docs = await queryBoundDocuments(user, categoryId);
  await Promise.all(docs.map((doc) =>
    docsCollection().doc(doc._id).update({
      data: {
        categoryId: DEFAULT_CATEGORY_ID,
        categoryName: DEFAULT_CATEGORY_NAME
      }
    })
  ));
}

module.exports = {
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORY_NAME,
  clearLocalCategories,
  createCategory,
  deleteCategory,
  getCategoryById,
  getCategoryByIdFromList,
  getCategories,
  getDefaultCategory,
  getLocalCategories,
  saveLocalCategories,
  updateCategory
};
