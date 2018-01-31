/* small library to create pseudo-blockchain on ZeroNet */
//TODO: 
// OR add better detection of block modification and insertion, so if someone insert a block at the begining of the chain, the game master/reputation system could ban him (invalidating all his blocks)
// lazy computation when a new block is added to the last chain block

var atob64 = function (u8){
  return btoa(String.fromCharCode.apply(null, u8));
}

var b64toa = function (str){
  return atob(str).split('').map(function (c) { return c.charCodeAt(0); });
}

//return hex computed hash
var hash_block = function(prev_hash, owner, datab64)
{
  var hash = sha256.create();
  hash.update(prev_hash+":"+owner+":"+datab64);
  return hash.hex();
}

//base check function, hash check
var check_block = function(state, block)
{
  return true;
}

function zchain(name, frame)
{
  this.name = name;
  this.frame = frame;
  this.state = {}
  this.blocks = {} //hash -> {prev: previous hash, hash: block hash, data: deserialized data, owner: user auth_address}
  this.users = {} //auth_address -> map of hash => owned block
  this.cert_user_ids = {}
  this.to_build = true;
  this.check_callbacks = []
  this.process_callbacks = []
  this.build_callbacks = []
  this.starts = [] //start blocks (blocks without previous block)
  this.built = [] //final built chain, list of blocks

  this.addCheckCallback(check_block); //add basic block checking
}

//load all data
zchain.prototype.load = function()
{
  var _this = this;
  var regex = new RegExp("(\\w+)\\/"+this.name+".zchain");
  this.frame.cmd("fileList", {inner_path: "data/users/"}, function(list){
    for(var i = 0; i < list.length; i++){
      var match = regex.exec(list[i]);
      if(match)
        _this.loadUserFile(match[1]);
    }
  });
}

zchain.prototype.loadUserFile = function(auth_address)
{
  var _this = this;

  //cert_user_id resolve
  if(!_this.cert_user_ids[auth_address]){
    this.frame.cmd("fileGet",["data/users/"+auth_address+"/content.json",false],function(data){
      if(data){
        data = JSON.parse(data);
        if(data && data.cert_user_id)
          _this.cert_user_ids[auth_address] = data.cert_user_id;
      }
    });
  }

  //parse file
  this.frame.cmd("fileGet", {inner_path: "data/users/"+auth_address+"/"+this.name+".zchain", format: "base64"}, function(data){
    if(data){
      //decode zchain file
      var blocks = msgpack.decode(pako.inflate(b64toa(data)));
      if(blocks){
        var old_blocks = _this.users[auth_address];
        var new_blocks = {}
        _this.users[auth_address] = new_blocks;

        //store blocks
        for(var hash in blocks){
          var block = blocks[hash];
          var valid_hash = (hash_block(block[0] || "", auth_address, block[1]) == hash); 

          if(valid_hash){
            var old_block = (old_blocks ? old_blocks[hash] : null);
            if(old_block){ //block already referenced, preserve
              new_blocks[hash] = old_block;
              delete old_blocks[hash];
            }
            else{ //new block (msgpack block format is [prev_hash,datab64])
              var nblock = {
                prev: block[0] || "",
                data: msgpack.decode(b64toa(block[1])) || {},
                owner: auth_address,
                hash: hash
              }

              new_blocks[hash] = nblock;
              _this.blocks[hash] = nblock;

              _this.to_build = true; //flag rebuild
            }
          }
        }

        //cleanup removed blocks
        for(var hash in old_blocks){
          delete _this.blocks[hash];
          _this.to_build = true; //flag rebuild
        }
      }
    }
  });
}

//check if a block is valid
//return true or false
zchain.prototype.checkBlock = function(block)
{
  var valid = (this.check_callbacks.length > 0); 
  var i = 0;
  while(valid && i < this.check_callbacks.length){
    valid = this.check_callbacks[i](this.state, block);
    i++;
  }

  return valid;
}

//process block
zchain.prototype.processBlock = function(block)
{
  for(var i = 0; i < this.process_callbacks.length; i++)
    this.process_callbacks[i](this.state, block);
}

//ponderate blocks in function of their longest/(most diversified, experimental) paths (trust weight)
zchain.prototype.recursive_ponderate = function(block, user_dict)
{
  if(!user_dict)
    user_dict = {}
  user_dict[block.owner] = true;

  block.trust = 1; //default trust is 1
  if(block.next_blocks){
    if(Object.keys(block.next_blocks).length == 1){ //blocks line, single children
      var nblock = null;
      for(var hash in block.next_blocks)
        nblock = block.next_blocks[hash];

      this.recursive_ponderate(nblock, user_dict); //fill user_dict in this blocks line
      block.trust += nblock.trust; //add next block trust
    }
    else{ //multiple children
      //get max trust
      var max = 0;
      for(var hash in block.next_blocks){
        var nblock = block.next_blocks[hash];
        this.recursive_ponderate(nblock); 
        if(nblock.trust > max)
          max = nblock.trust;
      }

      block.trust += max*Object.keys(user_dict).length; //add maximum children trust multiplied by number of different users on this blocks line
    }
  }
}

zchain.prototype.buildGraph = function()
{
  //clear old graph
  for(var hash in this.blocks){
    var block = this.blocks[hash];
    delete block.prev_block;
    delete block.next_blocks;
  }

  //build graph
  this.starts = []
  for(var hash in this.blocks){
    var block = this.blocks[hash];
    var pblock = this.blocks[block.prev];
    if(!pblock) //no previous block, add to starts
      this.starts.push(block);
    else{ //previous block, add references
      block.prev_block = pblock;

      //next references
      var next_blocks = pblock.next_blocks;
      if(!next_blocks){
        pblock.next_blocks = {}
        next_blocks = pblock.next_blocks;
      }

      next_blocks[hash] = block;
    }
  }

  //ponderate paths
  for(var i = 0; i < this.starts.length; i++)
    this.recursive_ponderate(this.starts[i]);
}

//return true if rebuilt, false if nothing changed
zchain.prototype.build = function()
{
  if(this.to_build){
    this.to_build = false;
    this.built = []

    this.buildGraph();

    //build state
    this.state = {} //clear

    //prebuild callbacks
    for(var i = 0; i < this.build_callbacks.length; i++)
      this.build_callbacks[i](this.state, true);

    //build chain
    var nodes = this.starts; //begin with start blocks
    while(nodes.length > 0){
      //sort nodes by ASC trust and ASC hash order on equal trust
      nodes.sort(function(a,b){ return (a.trust < b.trust) || (a.trust == b.trust && a.hash < b.hash); });
      //reverse (trustables first)
      nodes.reverse();

      var done = false;
      var i = 0;
      //take first valid block and process it
      while(!done && i < nodes.length){
        var block = nodes[i];
        if(this.checkBlock(block)){ //check
          this.processBlock(block); //process
          this.built.push(block);

          //update nodes => next blocks
          nodes = []
          var next_blocks = block.next_blocks;
          if(next_blocks){
            for(var hash in next_blocks)
              nodes.push(next_blocks[hash]);
          }

          done = true;
        }

        i++;
      }

      //clear nodes (no valid block found)
      if(!done)
        nodes = []
    }

    //postbuild callbacks
    for(var i = 0; i < this.build_callbacks.length; i++)
      this.build_callbacks[i](this.state, false);

    return true;
  }

  return false;
}

zchain.prototype.getCertUserId = function(auth_address)
{
  return this.cert_user_ids[auth_address] || auth_address;
}

//handle site_info (events, dynamic update, account)
//info: site_info
zchain.prototype.handleSiteInfo = function(info)
{
  var evt = info.event;
  if(evt){
    if(evt[0] == "file_done"){
      var regex = new RegExp("(\\w+)\\/"+this.name+".zchain");
      var match = regex.exec(evt[1]);
      if(match)
        this.loadUserFile(match[1]);
    }
  }
}

//push a new block to the chain as the current cert id user
//bdata: js object
zchain.prototype.push = function(bdata)
{
  var _this = this;

  //get chain head
  var head = null;
  if(this.built.length > 0)
    head = this.built[this.built.length-1];


  this.frame.cmd("siteInfo", {}, function(info){
    var file = "data/users/"+info.auth_address+"/"+_this.name+".zchain";

    if(info.cert_user_id){
      _this.frame.cmd("fileGet", {inner_path: file, required: false, format: "base64"}, function(data){
        //read blocks
        var blocks = {}
        if(data)
          blocks = msgpack.decode(pako.inflate(b64toa(data)));

        //add block
        var bdatab64 = atob64(msgpack.encode(bdata));
        blocks[hash_block((head ? head.hash : ""), info.auth_address, bdatab64)] = [(head ? head.hash : ""), bdatab64];

        //write blocks to zchain file
        _this.frame.cmd("fileWrite", {inner_path: file, content_base64: atob64(pako.deflate(msgpack.encode(blocks)))}, function(res){
          if(res == "ok"){
            //sign and publish
            var cfile = "data/users/"+info.auth_address+"/content.json";
            _this.frame.cmd("siteSign", {inner_path: cfile}, function(res){
              _this.frame.cmd("sitePublish", {inner_path: cfile, sign: false});
              _this.loadUserFile(info.auth_address);
            });
          }
          else
            _this.frame.cmd("wrapperNotification", ["error", "File write error: "+res]);
        });
      });
    }
    else
      _this.frame.cmd("wrapperNotification", ["error", "Can't push zchain block if not logged."]);
  });
}

//cleanup invalid blocks
//- force_purge: if set, will remove "orphan" blocks (bad logic check), if blocks are not properly loaded, calling this can remove all of them
zchain.prototype.cleanup = function(force_purge)
{
  var _this = this;

  this.frame.cmd("siteInfo", {}, function(info){
    var file = "data/users/"+info.auth_address+"/"+_this.name+".zchain";

    if(info.cert_user_id){
      _this.frame.cmd("fileGet", {inner_path: file, required: false, format: "base64"}, function(data){
        var changed = false;

        //read blocks
        var blocks = {}
        if(data)
          blocks = msgpack.decode(pako.inflate(b64toa(data)));

        //cleanup invalid blocks
        for(var hash in blocks){
          var block = blocks[hash];
          var valid_hash = (hash_block(block[0] || "", info.auth_address, block[1]) == hash); 


          //if force_purge set, remove missing block references
          var purge = false;
          if(force_purge){
            var block_ref = _this.blocks[hash];
            purge = (block_ref && _this.built.indexOf(block_ref) < 0);
          }

          //delete check
          if(!valid_hash || purge){
            changed = true;
            delete blocks[hash];
          }
        }

        if(changed){
          //write blocks to zchain file
          _this.frame.cmd("fileWrite", {inner_path: file, content_base64: atob64(pako.deflate(msgpack.encode(blocks)))}, function(res){
            if(res == "ok"){
              //sign and publish
              var cfile = "data/users/"+info.auth_address+"/content.json";
              _this.frame.cmd("siteSign", {inner_path: cfile}, function(res){
                _this.frame.cmd("sitePublish", {inner_path: cfile, sign: false});
                _this.loadUserFile(info.auth_address);
              });
            }
            else
              _this.frame.cmd("wrapperNotification", ["error", "File write error: "+res]);
          });
        }
        else
          _this.frame.cmd("wrapperNotification", ["error", "Nothing to cleanup (zchain)."]);
      });
    }
    else
      _this.frame.cmd("wrapperNotification", ["error", "Can't cleanup zchain blocks if not logged."]);
  });
}



//register a block check callback, used to check the validity of a block 
//if only one of the check callbacks return false, the block is invalid
//cb(state, block): should return true/false to mark the block as valid/invalid
zchain.prototype.addCheckCallback = function(cb)
{
  this.check_callbacks.push(cb);
}

//register a block process callback, used to process a block data to compute the chain state
//cb(state, block)
zchain.prototype.addProcessCallback = function(cb)
{
  this.process_callbacks.push(cb);
}

//register a build callback
//cb(state, pre)
//- pre: boolean, true if pre build, false if post build
zchain.prototype.addBuildCallback = function(cb)
{
  this.build_callbacks.push(cb);
}
