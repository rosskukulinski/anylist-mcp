/**
 * Regression test: a failed login/getLists (e.g. AnyList 429) must not leave a
 * half-initialised client behind. Before the fix, connect() kept `this.client`
 * with an empty list cache, skipped re-login on every later call, and reported
 * every list as "not found. Available lists: " until the process restarted.
 */
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import AnyList from '../anylist-js/lib/index.js';
import AnyListClient from '../src/anylist-client.js';

afterEach(() => mock.restoreAll());

function stubAnyList({ failGetListsTimes = 0 } = {}) {
  let getListsCalls = 0;
  const login = mock.method(AnyList.prototype, 'login', async function () {});
  mock.method(AnyList.prototype, 'getLists', async function () {
    getListsCalls += 1;
    if (getListsCalls <= failGetListsTimes) {
      throw new Error('Response code 429 (Too Many Requests)');
    }
    this.lists = [{ name: 'Standing Grocery List' }, { name: 'Xmas 2026' }];
    return this.lists;
  });
  mock.method(AnyList.prototype, 'getListByName', function (name) {
    return (this.lists || []).find((l) => l.name === name);
  });
  const teardown = mock.method(AnyList.prototype, 'teardown', function () {});
  return { login, teardown };
}

function newClient() {
  return new AnyListClient({
    username: 'test@example.com',
    password: 'pw',
    defaultListName: 'Standing Grocery List',
  });
}

test('connect() recovers on the next call after a 429 during getLists', async () => {
  const { login, teardown } = stubAnyList({ failGetListsTimes: 1 });
  const client = newClient();

  await assert.rejects(client.connect('Xmas 2026'), /429/);
  assert.equal(client.client, null, 'half-initialised client must be discarded');
  assert.equal(teardown.mock.callCount(), 1, 'stale websocket must be closed');

  await client.connect('Xmas 2026');
  assert.equal(client.targetList.name, 'Xmas 2026');
  assert.equal(login.mock.callCount(), 2, 'second call must log in again');
});

test('connect() keeps a healthy session when only the list name is wrong', async () => {
  const { login } = stubAnyList();
  const client = newClient();

  await assert.rejects(client.connect('No Such List'), /not found\. Available lists: Standing Grocery List, Xmas 2026/);
  assert.notEqual(client.client, null);

  await client.connect('Xmas 2026');
  assert.equal(login.mock.callCount(), 1, 'a valid session should not re-login');
});
