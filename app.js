/** @typedef {import('pear-interface')} */  /* global Pear */
// Pear.updates(() => Pear.reload())
import b4a from 'b4a'
import Autobase from 'autobase'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'

const {teardown, updates} = Pear

let swarm
let store
let autobase
let chatTopic
let chatSwarm

// Simple in-memory view for mobile-style items
const remoteItems = new Map()

function updateTextareaFromRemoteItems () {
    const textarea = document.getElementById('list')
    if (!textarea) return

    const items = Array.from(remoteItems.values())

    // Example ordering: not-done first, then done; oldest first
    items.sort((a, b) => {
        if (!!a.isDone === !!b.isDone) {
            return (a.timestamp || 0) - (b.timestamp || 0)
        }
        return a.isDone - b.isDone  // false (0) before true (1)
    })

    textarea.value = items.map((i) => i.text).join('\n')
}
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



function setupChatSwarm () {
    // discoveryKey is 32 bytes, good for Hyperswarm topic
    // chatTopic = crypto.discoveryKey(autobase.key)
    chatTopic = autobase.key

    chatSwarm = new Hyperswarm()

    chatSwarm.on('connection', (conn, info) => {
        console.log('chat connection', info.peer)

        // Start handshake
        setupHandshakeChannel(conn)
    })

    chatSwarm.join(chatTopic, { server: true, client: true })
}

async function apply (nodes, view, host) {
    console.log('applying nodes on guest', nodes)
    for (const { value } of nodes) {
        if (!value) continue

        // 1) writer membership (desktop + mobile compatible)
        if (value.type === 'add-writer') {
            console.log('adding writer', value.key)
            await host.addWriter(Buffer.from(value.key, 'hex'), { indexer: false }) // safer than true
            continue
        }

        // 2) Desktop’s own "full list" ops
        if (value.type === 'list') {
            console.log('adding list to the textarea', value)
            const textarea = document.getElementById('list')
            if (textarea) {
                textarea.value = valueToList(value)
            }
            await view.append(value)
            console.log('is autobase writable?', autobase.writable)
            continue
        }

        // 3) Mobile-style item ops: { type: 'add' | 'update' | 'delete', value: { ...item } }
        if (value.type === 'add' || value.type === 'update' || value.type === 'delete') {
            const item = value.value
            if (!item || typeof item.text !== 'string') {
                console.warn('Received mobile op with invalid item:', value)
                continue
            }

            const id = item.id || item.text // fallback if id missing

            switch (value.type) {
                case 'add':
                case 'update':
                    remoteItems.set(id, item)
                    break
                case 'delete':
                    remoteItems.delete(id)
                    break
            }

            // After applying the op, reflect mobile list in the textarea
            updateTextareaFromRemoteItems()
            // Optionally append to view so history keeps everything
            await view.append(value)
            continue
        }

        // 4) Anything else: just append so the log isn't lost
        await view.append(value)
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

    const connectionKeyHex = document.querySelector('#connection-key').value.trim()
    const connectionKey = b4a.from(connectionKeyHex, 'hex')

    // await initialize(folderName)

    if (!autobase) {
        autobase = new Autobase(store, connectionKey, { apply, open, valueEncoding: 'json' })
    }

    await autobase.ready()
    console.log('autobase ready with key...', autobase.key.toString('hex'))
    document.getElementById('autobase-label').innerHTML = autobase.key.toString('hex')

    const baseTopic = autobase.key
    swarm.join(baseTopic, { server: true, client: true })
    swarm.on('connection', (conn, info) => {
        autobase.replicate(conn, info.client)
    })

    // NEW: start handshake chat swarm
    setupChatSwarm()
})

document.querySelector('#create-form').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    // await initialize(folderName)

    if (!autobase) {
        autobase = new Autobase(store, null, { apply, open, valueEncoding: 'json' })
    }
    await autobase.ready()
    console.log('autobase ready with key...', autobase.key.toString('hex'))
    document.getElementById('autobase-label').innerHTML = autobase.key.toString('hex')

    // Start replication swarm on base topic (what you already do)
    const baseTopic = autobase.key
    swarm.join(baseTopic, { server: true, client: true })
    swarm.on('connection', (conn, info) => {
        autobase.replicate(conn, info.client)  // your existing manageAutobaseConnection
    })

    // NEW: start handshake chat swarm
    setupChatSwarm()
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

function sendHandshakeMessage (conn, msg) {
    const line = JSON.stringify(msg) + '\n'
    conn.write(line)
}

function setupHandshakeChannel (conn) {
    // 1) Immediately send *our* writer key
    const myWriterKeyHex = autobase.local.key.toString('hex')
    sendHandshakeMessage(conn, {
        type: 'writer-key',
        key: myWriterKeyHex,
    })

    // 2) Parse incoming JSON lines
    let buffer = ''
    conn.on('data', (chunk) => {
        buffer += chunk.toString()
        let idx
        while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            if (!line.trim()) continue

            let msg
            try {
                msg = JSON.parse(line)
            } catch (e) {
                console.warn('invalid JSON from peer:', line)
                continue
            }

            handleHandshakeMessage(msg)
        }
    })
}


const knownWriters = new Set()

async function handleHandshakeMessage (msg) {
    if (!msg || msg.type !== 'writer-key') return

    const remoteKeyHex = msg.key
    if (!remoteKeyHex || typeof remoteKeyHex !== 'string') return

    if (knownWriters.has(remoteKeyHex)) return
    knownWriters.add(remoteKeyHex)

    // Only a writer can add other writers.
    if (!autobase.writable) {
        console.log('Not writable here, cannot add remote writer yet')
        return
    }

    console.log('Adding remote writer via autobase:', remoteKeyHex)

    await autobase.append({
        type: 'add-writer',
        key: remoteKeyHex,
    })
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
        console.log('autobase is not writable, waiting for the owner to grant write access.')
        alert('Waiting for the owner to grant write access.')
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
