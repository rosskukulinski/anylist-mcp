/**
 * Tests for category operations: getCategories, createCategory, renameCategory,
 * deleteCategory, setItemCategory
 */
import { createConnectedClient, makeRunner, printSuiteResults } from './helpers.js';

const CATEGORY = '🧪 Test Category';
const CATEGORY_RENAMED = '🧪 Test Category Renamed';
const ITEM = '🧪 Test Categorized Item';

export async function runCategoriesTests() {
  console.log('\n🏷️  Categories');
  const { test, results } = makeRunner();

  const client = await createConnectedClient();

  // Pre-clean
  for (const name of [CATEGORY, CATEGORY_RENAMED]) {
    try { await client.deleteCategory(name); } catch {}
  }
  try { await client.deleteItem(ITEM); } catch {}

  await test('getCategories returns array with name and identifier', async () => {
    const categories = client.getCategories();
    if (!Array.isArray(categories)) throw new Error('getCategories() should return an array');
    if (categories.length === 0) throw new Error('Expected at least one category on the list');
    const category = categories[0];
    if (typeof category.name !== 'string') throw new Error('Category should have a name string');
    if (typeof category.identifier !== 'string') throw new Error('Category should have an identifier string');
  });

  await test('createCategory creates a custom category with an arbitrary name', async () => {
    const created = await client.createCategory(CATEGORY);
    if (created.name !== CATEGORY) throw new Error(`Expected "${CATEGORY}", got "${created.name}"`);
    if (!client.getCategories().some(c => c.name === CATEGORY)) {
      throw new Error('New category should appear in getCategories()');
    }
  });

  await test('createCategory rejects a duplicate name', async () => {
    let threw = false;
    try {
      await client.createCategory(CATEGORY);
    } catch (e) {
      threw = true;
      if (!e.message.includes('already exists')) throw new Error(`Expected duplicate error, got: ${e.message}`);
    }
    if (!threw) throw new Error('Should have thrown for a duplicate category');
  });

  await test('setItemCategory assigns an item to a custom category', async () => {
    await client.addItem(ITEM, 1);
    await client.setItemCategory(ITEM, CATEGORY);
    const items = await client.getItems(true);
    const item = items.find(i => i.name === ITEM);
    if (!item) throw new Error('Item not found after categorizing');
    if (item.category !== CATEGORY) throw new Error(`Expected category "${CATEGORY}", got "${item.category}"`);
  });

  await test('setItemCategory matches category names case-insensitively', async () => {
    await client.setItemCategory(ITEM, CATEGORY.toLowerCase());
    const items = await client.getItems(true);
    const item = items.find(i => i.name === ITEM);
    if (item.category !== CATEGORY) throw new Error(`Expected category "${CATEGORY}", got "${item.category}"`);
  });

  await test('setItemCategory reports available categories for an unknown category', async () => {
    let threw = false;
    try {
      await client.setItemCategory(ITEM, '🧪 No Such Category');
    } catch (e) {
      threw = true;
      if (!e.message.includes('not found') || !e.message.includes('Available categories')) {
        throw new Error(`Expected a not-found error listing categories, got: ${e.message}`);
      }
    }
    if (!threw) throw new Error('Should have thrown for an unknown category');
  });

  await test('renameCategory renames an existing category', async () => {
    const updated = await client.renameCategory(CATEGORY, CATEGORY_RENAMED);
    if (updated.name !== CATEGORY_RENAMED) throw new Error(`Expected "${CATEGORY_RENAMED}", got "${updated.name}"`);
    if (!client.getCategories().some(c => c.name === CATEGORY_RENAMED)) {
      throw new Error('Renamed category should appear in getCategories()');
    }
  });

  await test('deleteCategory removes the category', async () => {
    await client.deleteCategory(CATEGORY_RENAMED);
    if (client.getCategories().some(c => c.name === CATEGORY_RENAMED)) {
      throw new Error('Deleted category should no longer appear in getCategories()');
    }
  });

  // Cleanup
  try { await client.deleteItem(ITEM); } catch {}

  await client.disconnect();
  return printSuiteResults('Categories', results());
}
