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
It's also possible to replace the current chain by generating a chain more trustable than the first (more blocks, more users). But more the game advance, more it's hard for a single user to replace the chain this way (limited storage).
Modifying the chain rules (check/process) can invalid blocks of the chain, but it depends on the chain logic. It's possible to add new features, backward effectives and preserving the chain.


## Use cases / Ideas

### Timestamp blocks

You can timestamp blocks with a unit like 10 minutes to prevent sync issues, then each block will be constrained in time between the last block and the next (more the chain is active, less time cheating will be possible).

### Ban players

If some players are modifiyng their blocks or deleting them to troll, you could ban them using a check callback and a simple list.
