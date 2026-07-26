import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/tools/shopping.js';
import { MockAnyListClient, createMockServer } from './helpers.js';

describe('shopping tool', () => {
  let client;
  let handlers;

  beforeEach(() => {
    client = new MockAnyListClient();
    const { server, handlers: h } = createMockServer();
    register(server, () => Promise.resolve(client));
    handlers = h;
  });

  describe('add_item', () => {
    it('adds an item', async () => {
      const result = await handlers.shopping({ action: 'add_item', name: 'Milk' });
      assert.ok(result.content[0].text.includes('Successfully added "Milk"'));
      assert.equal(client._items.length, 1);
      assert.equal(client._items[0].name, 'Milk');
    });

    it('adds item with quantity and notes', async () => {
      await handlers.shopping({ action: 'add_item', name: 'Eggs', quantity: 2, notes: 'organic' });
      assert.equal(client._items[0].quantity, 2);
      assert.equal(client._items[0].notes, 'organic');
    });


    it ('should default to "other" category if not provided', async () => {
      await handlers.shopping({ action: 'add_item', name: 'Bread' });
      assert.equal(client._items[0].category, 'other');
    });

    it('should set category when provided', async () => {
      client._categories = [{ name: 'Produce', identifier: 'c-1', systemCategory: 'produce' }];
      await handlers.shopping({ action: 'add_item', name: 'Bananas', category: 'produce' });
      assert.equal(client._items[0].category, 'Produce');
    });

    it('should return error for a category the list does not have', async () => {
      client._categories = [{ name: 'Produce', identifier: 'c-1', systemCategory: 'produce' }];
      const result = await handlers.shopping({ action: 'add_item', name: 'Soda', category: 'invalid-category' });
      assert.ok(result.content[0].text.includes('not found'));
      assert.ok(result.content[0].text.includes('Produce'));
    });
  });

  describe('check_item', () => {
    it('checks off an existing item', async () => {
      client._items.push({ name: 'Milk', checked: false });
      const result = await handlers.shopping({ action: 'check_item', name: 'Milk' });
      assert.ok(result.content[0].text.includes('Successfully checked off'));
      assert.equal(client._items[0].checked, true);
    });

    it('returns error for non-existent item', async () => {
      const result = await handlers.shopping({ action: 'check_item', name: 'Nonexistent' });
      assert.equal(result.isError, true);
      assert.ok(result.content[0].text.includes('not found'));
    });
  });

  describe('delete_item', () => {
    it('deletes an existing item', async () => {
      client._items.push({ name: 'Milk' });
      const result = await handlers.shopping({ action: 'delete_item', name: 'Milk' });
      assert.ok(result.content[0].text.includes('Successfully deleted'));
      assert.equal(client._items.length, 0);
    });

    it('returns error for non-existent item', async () => {
      const result = await handlers.shopping({ action: 'delete_item', name: 'Ghost' });
      assert.equal(result.isError, true);
    });
  });

  describe('list_items', () => {
    it('returns empty message when no items', async () => {
      const result = await handlers.shopping({ action: 'list_items' });
      assert.ok(result.content[0].text.includes('No unchecked items'));
    });

    it('lists items grouped by category', async () => {
      client._items.push({ name: 'Milk', category: 'Dairy' }, { name: 'Bread', category: 'Bakery' });
      const result = await handlers.shopping({ action: 'list_items' });
      assert.ok(result.content[0].text.includes('Milk'));
      assert.ok(result.content[0].text.includes('Bread'));
      assert.ok(result.content[0].text.includes('Dairy'));
      assert.ok(result.content[0].text.includes('Bakery'));
    });

    it('excludes checked items by default', async () => {
      client._items.push({ name: 'Milk', checked: false }, { name: 'Done', checked: true });
      const result = await handlers.shopping({ action: 'list_items' });
      assert.ok(result.content[0].text.includes('Milk'));
      assert.ok(!result.content[0].text.includes('Done'));
    });

    it('includes checked items when requested', async () => {
      client._items.push({ name: 'Milk', checked: false }, { name: 'Done', checked: true });
      const result = await handlers.shopping({ action: 'list_items', include_checked: true });
      assert.ok(result.content[0].text.includes('Done'));
    });

    it('includes notes when requested', async () => {
      client._items.push({ name: 'Milk', notes: 'whole milk' });
      const result = await handlers.shopping({ action: 'list_items', include_notes: true });
      assert.ok(result.content[0].text.includes('whole milk'));
    });
  });

  describe('list_lists', () => {
    it('returns empty message when no lists', async () => {
      const result = await handlers.shopping({ action: 'list_lists' });
      assert.ok(result.content[0].text.includes('No lists found'));
    });

    it('returns list names with counts', async () => {
      client._lists = [
        { name: 'Groceries', uncheckedCount: 5 },
        { name: 'Costco', uncheckedCount: 2 },
      ];
      const result = await handlers.shopping({ action: 'list_lists' });
      assert.ok(result.content[0].text.includes('Groceries'));
      assert.ok(result.content[0].text.includes('5 unchecked'));
    });
  });

  describe('get_favorites', () => {
    it('returns empty message when no favorites', async () => {
      const result = await handlers.shopping({ action: 'get_favorites' });
      assert.ok(result.content[0].text.includes('No favorite items'));
    });

    it('returns favorite items', async () => {
      client._favorites = [{ name: 'Bananas', details: 'organic' }];
      const result = await handlers.shopping({ action: 'get_favorites' });
      assert.ok(result.content[0].text.includes('Bananas'));
      assert.ok(result.content[0].text.includes('organic'));
    });
  });

  describe('get_recents', () => {
    it('returns empty message when no recents', async () => {
      const result = await handlers.shopping({ action: 'get_recents' });
      assert.ok(result.content[0].text.includes('No recent items'));
    });

    it('returns recent items', async () => {
      client._recents = [{ name: 'Avocado' }];
      const result = await handlers.shopping({ action: 'get_recents' });
      assert.ok(result.content[0].text.includes('Avocado'));
    });
  });

  describe('list_categories', () => {
    it('returns empty message when the list has no categories', async () => {
      const result = await handlers.shopping({ action: 'list_categories' });
      assert.ok(result.content[0].text.includes('No categories found'));
    });

    it('marks custom categories and leaves system ones unmarked', async () => {
      client._categories = [
        { name: 'Produce', identifier: 'c-1', systemCategory: 'produce' },
        { name: 'Hannah', identifier: 'c-2', systemCategory: null },
      ];
      const text = (await handlers.shopping({ action: 'list_categories' })).content[0].text;
      assert.ok(text.includes('- Produce\n'));
      assert.ok(text.includes('- Hannah (custom)'));
    });
  });

  describe('create_category', () => {
    it('creates a category with an arbitrary name', async () => {
      const result = await handlers.shopping({ action: 'create_category', category: 'Hannah' });
      assert.ok(result.content[0].text.includes('Successfully created category "Hannah"'));
      assert.equal(client._categories.length, 1);
      assert.equal(client._categories[0].name, 'Hannah');
    });

    it('errors when the category already exists', async () => {
      client._categories = [{ name: 'Hannah', identifier: 'c-1', systemCategory: null }];
      const result = await handlers.shopping({ action: 'create_category', category: 'Hannah' });
      assert.ok(result.content[0].text.includes('already exists'));
    });
  });

  describe('rename_category', () => {
    it('renames an existing category', async () => {
      client._categories = [{ name: 'Hannah', identifier: 'c-1', systemCategory: null }];
      const result = await handlers.shopping({ action: 'rename_category', category: 'Hannah', new_name: 'Hannah Snacks' });
      assert.ok(result.content[0].text.includes('renamed category "Hannah" to "Hannah Snacks"'));
      assert.equal(client._categories[0].name, 'Hannah Snacks');
    });

    it('errors for an unknown category', async () => {
      const result = await handlers.shopping({ action: 'rename_category', category: 'Nope', new_name: 'Whatever' });
      assert.ok(result.content[0].text.includes('not found'));
    });
  });

  describe('delete_category', () => {
    it('deletes an existing category', async () => {
      client._categories = [{ name: 'Hannah', identifier: 'c-1', systemCategory: null }];
      const result = await handlers.shopping({ action: 'delete_category', category: 'Hannah' });
      assert.ok(result.content[0].text.includes('Successfully deleted category "Hannah"'));
      assert.equal(client._categories.length, 0);
    });

    it('errors for an unknown category', async () => {
      const result = await handlers.shopping({ action: 'delete_category', category: 'Nope' });
      assert.ok(result.content[0].text.includes('not found'));
    });
  });

  describe('set_item_category', () => {
    beforeEach(() => {
      client._categories = [
        { name: 'Hannah', identifier: 'c-1', systemCategory: null },
        { name: 'Produce', identifier: 'c-2', systemCategory: 'produce' },
      ];
    });

    it('moves an item into a custom category', async () => {
      client._items = [{ name: 'Milk' }];
      const result = await handlers.shopping({ action: 'set_item_category', name: 'Milk', category: 'Hannah' });
      assert.ok(result.content[0].text.includes('moved "Milk" to category "Hannah"'));
      assert.equal(client._items[0].category, 'Hannah');
    });

    it('matches category names case-insensitively', async () => {
      client._items = [{ name: 'Milk' }];
      await handlers.shopping({ action: 'set_item_category', name: 'Milk', category: 'hannah' });
      assert.equal(client._items[0].category, 'Hannah');
    });

    it('still accepts a system category id', async () => {
      client._items = [{ name: 'Apples' }];
      await handlers.shopping({ action: 'set_item_category', name: 'Apples', category: 'produce' });
      assert.equal(client._items[0].category, 'Produce');
    });

    it('errors with the available categories when the category is unknown', async () => {
      client._items = [{ name: 'Milk' }];
      const text = (await handlers.shopping({ action: 'set_item_category', name: 'Milk', category: 'Nope' })).content[0].text;
      assert.ok(text.includes('not found'));
      assert.ok(text.includes('Hannah, Produce'));
    });

    it('errors when the item does not exist', async () => {
      const result = await handlers.shopping({ action: 'set_item_category', name: 'Ghost', category: 'Hannah' });
      assert.ok(result.content[0].text.includes('not found'));
    });
  });

  describe('add_item with categories', () => {
    it('accepts an arbitrary category name', async () => {
      client._categories = [{ name: 'Hannah', identifier: 'c-1', systemCategory: null }];
      await handlers.shopping({ action: 'add_item', name: 'Milk', category: 'Hannah' });
      assert.equal(client._items[0].category, 'Hannah');
    });
  });
});
