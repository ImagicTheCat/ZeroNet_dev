# zchain 

Library to implement a pseudo-blockchain (.zchain files) for ZeroNet.
Example/base-zite (on ZeroNet): http://127.0.0.1:43110/19j7vqt8gaAh9WFtnH3w8m97WakWANVwmN

Topic (on ZeroNet): http://127.0.0.1:43110/142jqssVAj2iRxMACJg2dzipB5oicZYz5w/?Topic:1517355233_1Cz74bvSRgWqHaLCBUTrJPW7uvKyr8P8RC

## Dependencies

* pako.min.js: https://github.com/nodeca/pako (compression)
* sha256.min.js: https://github.com/emn178/js-sha256 (hash)
* msgpack.min.js: https://github.com/kawanet/msgpack-lite (serialization)

## Optimizations

* batch transactions in a single block to minimize the block 128 bytes overhead
* don't push a block each time the user do something, but periodically commit the changes instead to prevent ZeroNet publish latency generating too much invalid blocks

## Integrity

zchain is about integrity, the chain will rollback to the previous valid block when a block is modified or deleted. 
A user can only invalid the blocks following his blocks this way, in some case (total deletion) the following blocks could be the new chain origin. 
It's also possible to replace the current chain by generating a chain more trustable than the first (more blocks, more users). But more the chain advance, more it's hard for a single user to replace it this way (limited storage).
Modifying the chain rules (check/process) can invalid blocks of the chain, but it depends on the chain logic. It's possible to add new features, retroactives and preserving the chain.

## Use cases / Ideas

### Timestamp blocks

You can timestamp blocks with a unit like 10 minutes to prevent sync issues, then each block will be constrained in time between the last block and the next (more the chain is active, less time cheating will be possible).

### Ban players

If some players are modifiyng their blocks or deleting them to troll, you could ban them using a check callback and a simple list.

### Snapshot

Since ZeroNet sites (zites) are owned by someone, this someone could create special blocks (snapshots) at the origin of the chain and set those blocks as the new chain origin. Those specials blocks could save the current state of the chain and invalid the other blocks, so users could cleanup their invalid blocks and push new blocks after this snapshot. This can save disk usage and drastically decrease the computation time of the state (it also makes the state more resistant to block modification/deletion, because the state can only rollback to the last snapshot). 

## API

```js
// zchain constructor
// name: identifier (data/users/*/<name>.zchain file used)
// frame: ZeroFrame API object
zchain(name, frame)

// load users data
zchain.load()

// load single user data
zchain.loadUserFile(auth_address)

// build chain and state (call this periodically to update the state)
// return true if rebuilt, false if nothing changed
zchain.build()

// get cert_user_id of a known chain auth_address
// return cert_user_id or auth_address if not found
zchain.getCertUserId(auth_address)

// handle site_info (events, dynamic update, account)
// info: site_info
zchain.handleSiteInfo(info)

// push a new block to the chain 
// bdata: block data as js object
// prev (optional): previous hash, default is chain last block
// auth_address (optional): user, default is current logged user (used to push as another user, ex: the zite owner)
zchain.push(bdata, prev, auth_address)

// cleanup invalid/unused blocks
// force_purge: if set (true), will remove unused blocks (bad logic check), if blocks are not properly loaded, using this can remove all of them
// auth_address (optional): user, default is current logged user (used to push as another user, ex: the zite owner)
zchain.cleanup(force_purge, auth_address)

// register precheck callbacks, used to check the validity of an user or individual block to be added to the chain graph
// cb_user(auth_address): should return true/false
// cb_block(block): should return true/false
zchain.addPreCheckCallbacks(cb_user, cb_block)

// register a block check callback, used to check the validity of a block 
// this callback is guaranteed to be called after all previous valid blocks were processed for a specific state and before the next block processing
// if only one of the check callbacks return false, the block is invalid
// cb(state, block): should return true/false to mark the block as valid/invalid
zchain.addCheckCallback(cb)

// register a block process callback, used to process a block data to compute the chain state
// this callback is guaranteed to be called after the block validation for a specific state, it should only modify the passed state
// cb(state, block)
zchain.addProcessCallback(cb)

// register a build callback
// called before the build (init state) and at the end of the build (stats are availables)
// cb(state, pre)
//   pre: boolean, true if pre build, false if post build
zchain.addBuildCallback(cb)
```
### Data

* zchain
  * stats
  * blocks (all loaded blocks, map of hash => block)
  * users (users block references, map of auth_address => (map of hash => block))
  * built (list of blocks, final built chain)
  * state (built state)

* block (when loaded)
  * prev (previous block hash)
  * hash (block hash)
  * data (block data)
  * owner (user auth_address)

* block (after/when building, keeps previous properties)
  * prev_block (previous block reference)
  * next_blocks (children blocks, map of hash => block)
  * trust

## Usage example

```js
// create chain (page is the ZeroFrame API object)
var chain = zchain("test", page); // test.zchain will be used in each user data directory

// define the chain logic
// chain.addPreCheckCallbacks (accept/deny users and blocks)

chain.addBuildCallback(function(state, pre){
  if(pre){
    // init state
  }
  else{
    // finalize state, update things, display stats
  }
});

chain.addCheckCallback(function(state, block){
  // check block
});

chain.addProcessCallback(function(state, block){
  // process block
});

// create or use an existing ZeroFrame API object, and send any site_info changes to the chain
class Page extends ZeroFrame {
  setSiteInfo(site_info) {
    chain.handleSiteInfo(site_info); 
    // ...
  }
  // ...
}

// start an update loop
setInterval(function(){ 
  if(chain.build()){
    // changed
    // update things, display stats
  }
}, 1500);
```
