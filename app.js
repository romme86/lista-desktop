/** @typedef {import('pear-interface')} */ /* global Pear */
// Pear.updates(() => Pear.reload())


import b4a from 'b4a'
import Autobase from 'autobase'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
// import Buffer from "b4a";
const {teardown, updates} = Pear


let swarm = null
let store = null
let autobase = null
let writerKey = null

async function initialize(folder_name) {
    swarm = new Hyperswarm()
    store = new Corestore(`./${folder_name}`)
    await store.ready()
    console.log('corestore ready')
}

function open(store) {
    console.log('opening store...', store.get('test'))
    return store.get('test')
}

async function apply(nodes, view, host) {
    console.log('applying nodes on guest', nodes)
    console.log('is autobase writable?', autobase.writable)
    for (const {value} of nodes) {
        console.log(b4a.toString(value))
        if (writerKey != null) {
            console.log('writer key is not null', writerKey)
            const bufferWriterKey = Buffer.from(writerKey, 'hex')
            await host.addWriter(bufferWriterKey, {indexer: true});
            console.log('autobase writable now?', autobase.writable, 'host address', host)
            continue;
        }
        document.getElementById("list").value = valueToList(value)
        await view.append(value)
    }
}

async function apply_creator(nodes, view, host) {
    console.log('applying nodes on owner', nodes)
    for (const {value} of nodes) {
        console.log(b4a.toString(value))
        if (writerKey != null) {
            console.log('writer key is not null', writerKey)
            const bufferWriterKey = Buffer.from(writerKey, 'hex')
            await host.addWriter(bufferWriterKey, {indexer: true});
            console.log('autobase writable now?', autobase.writable, 'host address', host)
            continue;
        }
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
    console.log('submitted connection key')
    const connectionKey = document.querySelector('#connection-key').value
    if (autobase == null) {
        autobase = new Autobase(store, connectionKey, {apply, open})
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
        // refresh frontend?
    })
    autobase.on('ready', async () => {
        console.log('autobase ready')
    })
    swarm.on('connection', (connection) => {
        manageAutobaseConnection(connection, false);
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
        autobase = new Autobase(store, null, {apply_creator, open})
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
})


function manageAutobaseConnection(connection, initiator) {
    console.log('swarming with peer', connection)
    autobase.replicate(connection, initiator)
    let buffer = b4a.alloc(0);
    const localKey = b4a.toString(autobase.local.key, 'hex');
    connection.write(JSON.stringify({
        type: 'writer-key',
        key: localKey,
    }) + '\n');
    connection.on('data', async (data) => {
        buffer = b4a.concat([buffer, data]);
        const str = b4a.toString(buffer, 'utf8');
        const lines = str.split('\n');
        const incomplete = lines.pop();
        buffer = b4a.from(incomplete || '');
        for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            if (msg.type === 'writer-key') {
                writerKey = msg.key;
                console.log('saved writer-key', msg.key);
            }
        }
    })
}

function valueToList(valueFromAutobase) {
    const jsonParsed = JSON.parse(valueFromAutobase);
    console.log('textAreaValue', jsonParsed, typeof jsonParsed)
    const valueToList = jsonParsed.replace("[", "").replace("]", "").replaceAll("\"", "").replaceAll(",", "");
    console.log('cleanValue', valueToList)
    return valueToList
}

function convertListToJSON(textareaValue) {
    // Split by newlines and filter out empty lines
    const lines = textareaValue
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    return JSON.stringify(lines, null, 2);
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
        return
    }
    // append the new list to the autobase

    const textareavalue = document.getElementById("list").value
    console.log('textareavalue', textareavalue)
    const textareavalueJSON = convertListToJSON(textareavalue)

    await autobase.append(Buffer.from(JSON.stringify(textareavalueJSON)))


})

// teardown(() => swarm.destroy())
// updates(() => Pear.reload())

