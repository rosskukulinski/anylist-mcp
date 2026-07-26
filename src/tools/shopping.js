import { z } from "zod";
import { textResponse, errorResponse } from "./helpers.js";
import { createElicitationHelpers } from "./elicitation.js";

  // TODO: What does this do?
function buildDescription(stores) {
  const base = `Manage AnyList shopping lists and items. Actions:
- list_lists: Show all lists with item counts
- list_items: Show items on a list (grouped by category)
- add_item: Add an item to a list
- check_item: Check off (complete) an item
- delete_item: Permanently remove an item from a list
- get_favorites: Get favorite items for a list
- get_recents: Get recently added items for a list
- list_stores: list stores available for the list (if any)
- list_categories: Show the categories defined on a list
- create_category: Create a new custom category on a list
- rename_category: Rename an existing category
- delete_category: Delete a category from a list
- set_item_category: Move an existing item into a category`;
  if (!stores || stores.length === 0) return base;
  const storeList = stores.map(s => s.name).join(', ');
  return `${base}\n\nAvailable stores: ${storeList}`;
}

async function validateStoreName(client, storeName) {
  if (!storeName) return { valid: true, message: null };
  const stores = client.getStores();
  const storeNames = stores.map(s => s.name.toLowerCase());
  if (!storeNames.includes(storeName.toLowerCase())) {
    return { valid: false, message: `Store "${storeName}" not found in list "${client.targetList.name}". Available stores: ${storeNames.join(", ")}.
    Create a new store from the web application or mobile app, then try again.` };
  }
  return { valid: true, message: null };
}

export function register(server, getClient) {
  const { elicitListName, elicitItemChoice, elicitRequiredField } = createElicitationHelpers(server);

  function findPartialMatches(client, itemName) {
    const items = client.targetList.items || [];
    const lower = itemName.toLowerCase();
    return items
      .filter(i => !i.checked && i.name.toLowerCase().includes(lower))
      .map(i => i.name);
  }

  async function resolveItemName(client, itemName) {
    const exact = client.targetList.getItemByName(itemName);
    if (exact) return itemName;
    const matches = findPartialMatches(client, itemName);
    if (matches.length === 0) throw new Error(`Item "${itemName}" not found in list`);
    if (matches.length === 1) return matches[0];
    return await elicitItemChoice(itemName, matches);
  }

  let lastStoreSignature = '';

  const registeredTool = server.registerTool("shopping", {
    title: "Shopping Lists & Items",
    description: buildDescription([]),
    inputSchema: {
      action: z.enum(["list_lists", "list_items", "add_item",
        "set_item_store", "check_item", "delete_item", "get_favorites", "get_recents", "list_stores",
        "list_categories", "create_category", "rename_category", "delete_category", "set_item_category"]).describe("The shopping action to perform"),
      list_name: z.string().optional().describe("Name of the list (defaults to configured default list)"),
      name: z.string().optional().describe("Item name (required for add_item, set_item_store, check_item, delete_item)"),
      quantity: z.number().min(1).optional().describe("Item quantity (add_item only, defaults to 1)"),
      notes: z.string().optional().describe("Notes for the item (add_item only)"),
      include_checked: z.boolean().optional().describe("Include checked-off items (list_items only, default false)"),
      include_notes: z.boolean().optional().describe("Include notes for each item (list_items only, default false)"),
      category: z.string().optional().describe("Category name, matched against the list's own categories (add_item, set_item_category, create_category, rename_category, delete_category). Use list_categories to see what a list has."),
      new_name: z.string().optional().describe("New category name (rename_category only)"),
      store_name: z.string().optional().describe("Store to assign to this item (add_item and set_item_store only; omit or leave blank to clear)"),
    }
  }, async (params) => {
    const { action, list_name, name, quantity, notes, include_checked, include_notes, category, new_name } = params;
    try {
      const client = await getClient();
      switch (action) {
        case "list_lists": {
          await client.connect(list_name || null);
          const stores = client.getStores();
          const sig = stores.map(s => s.name).join(',');
          if (sig !== lastStoreSignature) {
            lastStoreSignature = sig;
            registeredTool.update({ description: buildDescription(stores) });
          }
          const lists = client.getLists();
          if (lists.length === 0) return textResponse("No lists found in the account.");
          const output = lists.map(l => `- ${l.name} (${l.uncheckedCount} unchecked items)`).join("\n");
          return textResponse(`Available lists (${lists.length}):\n${output}`);
        }
        case "list_items": {
          let resolvedListName = list_name;
          if (!resolvedListName && !client.defaultListName) {
            await client.connect(null);
            const lists = client.getLists();
            if (lists.length > 1) {
              resolvedListName = await elicitListName(lists);
            }
          }
          await client.connect(resolvedListName);
          const stores = client.getStores();
          const sig = stores.map(s => s.name).join(',');
          if (sig !== lastStoreSignature) {
            lastStoreSignature = sig;
            registeredTool.update({ description: buildDescription(stores) });
          }
          const items = await client.getItems(include_checked || false, include_notes || false);
          if (items.length === 0) {
            return textResponse(include_checked
              ? `List "${client.targetList.name}" is empty.`
              : `No unchecked items on list "${client.targetList.name}".`);
          }
          const itemsByCategory = {};
          items.forEach(item => {
            const cat = item.category || 'other';
            if (!itemsByCategory[cat]) itemsByCategory[cat] = [];
            itemsByCategory[cat].push(item);
          });
          const itemList = Object.keys(itemsByCategory).sort().map(category => {
            const categoryItems = itemsByCategory[category].map(item => {
              const qty = item.quantity > 1 ? ` (x${item.quantity})` : "";
              const status = item.checked ? " ✓" : "";
              const note = item.note ? ` [${item.note}]` : "";
              const store = item.store ? ` @${item.store}` : "";
              return `  - ${item.name}${qty}${status}${note}${store}`;
            }).join("\n");
            return `**${category}**\n${categoryItems}`;
          }).join("\n\n");
          return textResponse(`Shopping list "${client.targetList.name}" (${items.length} items):\n${itemList}`);
        }
        case "add_item": {
          let itemName = name;
          if (!itemName) itemName = await elicitRequiredField("name", "What item would you like to add?");
          await client.connect(list_name);
          
          const {valid, message} = await validateStoreName(client, params.store_name);
          if (!valid)
            return errorResponse(message); 

          await client.addItem(itemName, quantity || 1, notes || null, params.category || "other", params.store_name || null);
          return textResponse(`Successfully added "${itemName}" to list "${client.targetList.name}"`);
        }
        case "check_item": {
          let itemName = name;
          if (!itemName) itemName = await elicitRequiredField("name", "What item would you like to check off?");
          await client.connect(list_name);
          const resolvedCheck = await resolveItemName(client, itemName);
          await client.removeItem(resolvedCheck);
          return textResponse(`Successfully checked off "${resolvedCheck}" from list "${client.targetList.name}"`);
        }
        case "delete_item": {
          let itemName = name;
          if (!itemName) itemName = await elicitRequiredField("name", "What item would you like to delete?");
          await client.connect(list_name);
          const resolvedDelete = await resolveItemName(client, itemName);
          await client.deleteItem(resolvedDelete);
          return textResponse(`Successfully deleted "${resolvedDelete}" from list "${client.targetList.name}"`);
        }
        case "get_favorites": {
          await client.connect(list_name || null);
          const items = await client.getFavoriteItems(list_name);
          if (items.length === 0) return textResponse(`No favorite items for list "${client.targetList.name}".`);
          const list = items.map(i => `- ${i.name}${i.details ? ` [${i.details}]` : ''}`).join('\n');
          return textResponse(`Favorite items for "${client.targetList.name}" (${items.length}):\n${list}`);
        }
        case "get_recents": {
          await client.connect(list_name || null);
          const items = await client.getRecentItems(list_name);
          if (items.length === 0) return textResponse(`No recent items for list "${client.targetList.name}".`);
          const list = items.map(i => `- ${i.name}${i.details ? ` [${i.details}]` : ''}`).join('\n');
          return textResponse(`Recent items for "${client.targetList.name}" (${items.length}):\n${list}`);
        }
        case "list_stores": {
          await client.connect(list_name || null);
          const stores = client.getStores();
          if (stores.length === 0) return textResponse(`No stores found for list "${client.targetList.name}".`);
          const list = stores.map(s => `- ${s.name}`).join('\n');
          return textResponse(`Stores for "${client.targetList.name}" (${stores.length}):\n${list}`);
        }
        case "list_categories": {
          await client.connect(list_name || null);
          const categories = client.getCategories();
          if (categories.length === 0) return textResponse(`No categories found for list "${client.targetList.name}".`);
          const list = categories.map(c => `- ${c.name}${c.systemCategory ? '' : ' (custom)'}`).join('\n');
          return textResponse(`Categories for "${client.targetList.name}" (${categories.length}):\n${list}`);
        }
        case "create_category": {
          let categoryName = category;
          if (!categoryName) categoryName = await elicitRequiredField("category", "What should the new category be called?");
          await client.connect(list_name);
          const created = await client.createCategory(categoryName);
          return textResponse(`Successfully created category "${created.name}" on list "${client.targetList.name}"`);
        }
        case "rename_category": {
          let categoryName = category;
          if (!categoryName) categoryName = await elicitRequiredField("category", "Which category would you like to rename?");
          let renamedTo = new_name;
          if (!renamedTo) renamedTo = await elicitRequiredField("new_name", `What should "${categoryName}" be renamed to?`);
          await client.connect(list_name);
          const renamed = await client.renameCategory(categoryName, renamedTo);
          return textResponse(`Successfully renamed category "${categoryName}" to "${renamed.name}" on list "${client.targetList.name}"`);
        }
        case "delete_category": {
          let categoryName = category;
          if (!categoryName) categoryName = await elicitRequiredField("category", "Which category would you like to delete?");
          await client.connect(list_name);
          await client.deleteCategory(categoryName);
          return textResponse(`Successfully deleted category "${categoryName}" from list "${client.targetList.name}"`);
        }
        case "set_item_category": {
          let itemName = name;
          if (!itemName) itemName = await elicitRequiredField("name", "Which item would you like to categorize?");
          let categoryName = category;
          if (!categoryName) categoryName = await elicitRequiredField("category", `Which category should "${itemName}" go in?`);
          await client.connect(list_name);
          const resolvedItem = await resolveItemName(client, itemName);
          await client.setItemCategory(resolvedItem, categoryName);
          return textResponse(`Successfully moved "${resolvedItem}" to category "${categoryName}" on list "${client.targetList.name}"`);
        }
      }
    } catch (error) {
      return errorResponse(`Shopping ${action} failed: ${error.message}`);
    }
  });
}
