/** @typedef {import('pear-interface')} */ /* global Pear */
// Pear.updates(() => Pear.reload())
import b4a from 'b4a'
import Autobase from 'autobase'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
const {teardown, updates} = Pear

let swarm = null
let store = null
let autobase = null

async function initialize(folder_name) {
    swarm = new Hyperswarm()
    store = new Corestore(`./${folder_name}`)
    await store.ready()
    console.log('corestore ready')
}

function open(store) {
    const view = store.get({
        name: 'view',
        valueEncoding: 'json',
    })
    console.log('opening store...', view)
    return view
}

async function apply(nodes, view, host) {
    console.log('applying nodes on guest', nodes)
    for (const {value} of nodes) {
        if (value.type === 'add-writer') {
            console.log("adding writer", value.key)
            await host.addWriter(Buffer.from(value.key, 'hex'), { indexer: true })
            continue
        }
        if (value.type === 'list') {
            console.log("adding list to the textarea", value)
            const textarea = document.getElementById("list")
            textarea.value = valueToList(value)
            await view.append(value)
            console.log('is autobase writable?', autobase.writable)
        }
    }
}

document.querySelector('#folder-form').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    console.log('submitted folder creation')
    const folder_name = document.querySelector('#folder-name').value
    await initialize(folder_name)
})

document.querySelector('#key-form').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    console.log('submitted connection key')
    const connectionKeyHex = document.querySelector('#connection-key').value
    const connectionKey = b4a.from(connectionKeyHex, 'hex')
    if (autobase == null) {
        autobase = new Autobase(store, connectionKey, {apply, open, valueEncoding: 'json'}, )
    }
    await autobase.ready()
    console.log('autobase ready, writable? ', autobase.writable, 'local autobase key', autobase.local.key)
    const topic = autobase.key
    console.log('autobase connected to ', topic.toString('hex'))
    const discovery = swarm.join(topic, {server: true, client: true})
    discovery.flushed()
    console.log('discovered connection key and connected the swarm to the autobase topic')
    autobase.on('append', async () => {
        console.log('appending to autobase')
    })
    autobase.on('ready', async () => {
        console.log('autobase ready')
    })
    swarm.on('connection', (connection) => {
        manageAutobaseConnection(connection, false);
    })
    console.log('My writer key (share this with the host):', autobase.local.key.toString('hex'))
    autobase.append({
        type: 'add-writer',
        key: autobase.local.key.toString('hex'),
    })
})

document.querySelector('#create-form').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    console.log('submitted autobase creation')
    if (store == null) {
        console.log('store is null, stopping.')
        return
    }
    if (autobase == null) {
        autobase = new Autobase(store, null, {apply, open, valueEncoding: 'json'})
    }
    await autobase.ready()
    console.log('autobase ready, writable? ', autobase.writable, 'autobase key', autobase.key?.toString('hex'))
    const topic = autobase.key
    console.log('autobase connected to ', topic.toString('hex'))
    const discovery = swarm.join(topic, {server: true, client: true})
    await discovery.flushed()
    autobase.on('append', async () => {
        console.log('appending to autobase')
    })
    autobase.on('ready', async () => {
        console.log('autobase ready')
    })
    swarm.on('connection', (connection) => {
        manageAutobaseConnection(connection, true);
    })
    autobase.append({
        type: 'add-writer',
        key: autobase.local.key.toString('hex'),
    })
})


function manageAutobaseConnection(connection, initiator) {
    console.log('swarming with peer', connection)
    autobase.replicate(connection, initiator)
}

function valueToList(nodeValue) {
    // Expecting: { type: 'list', items: string[] } or items as JSON string
    const items = nodeValue.items;

    // If items is already an array (recommended)
    if (Array.isArray(items)) {
        return items.join('\n');
    }

    // If items is a JSON string (for backward compatibility)
    if (typeof items === 'string') {
        try {
            const parsed = JSON.parse(items);
            if (Array.isArray(parsed)) {
                return parsed.join('\n');
            }
            return String(items);
        } catch (e) {
            // Not valid JSON, just show raw string
            return String(items);
        }
    }

    return '';
}

function convertListToArray(textareaValue) {
    return textareaValue
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

document.querySelector('#list-form').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    console.log('submitted autobase list update')
    if (store == null) {
        console.log('store is null, stopping.')
        return
    }
    if (autobase == null) {
        console.log('autobase is null, stopping.')
        return
    }
    if (autobase.writable === false) {
        console.log('autobase is not writable, stopping.')
        alert('You are currently read-only on this Autobase. The creator must grant you write access.')
        return
    }

    const textareavalue = document.getElementById("list").value
    console.log('textareavalue', textareavalue)
    const items = convertListToArray(textareavalue)

    await autobase.append({
        type: 'list',
        items,
    })
})
