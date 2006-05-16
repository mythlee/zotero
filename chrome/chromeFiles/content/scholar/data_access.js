/*
 * Constructor for Object object
 *
 * Generally should be called through Scholar.Objects rather than directly
 */
Scholar.Object = function(){
	this._init();
	
	// Accept objectTypeID, folderID and orderIndex in constructor
	if (arguments.length){
		this.setType(arguments[0]);
		this.setPosition(arguments[1],arguments[2]);
	}
}

Scholar.Object.prototype._init = function(){
	//
	// Public members for access by public methods -- do not access directly
	//
	this._data = new Array();
	this._creators = new Scholar.Hash();
	this._objectData = new Array();
	
	this._creatorsLoaded = false;
	this._objectDataLoaded = false;
	
	this._changed = new Scholar.Hash();
	this._changedCreators = new Scholar.Hash();
	this._changedObjectData = new Scholar.Hash();
}


//////////////////////////////////////////////////////////////////////////////
//
// Public Scholar.Object methods
//
//////////////////////////////////////////////////////////////////////////////

/*
 * Check if the specified field is a primary field from the objects table
 */
Scholar.Object.prototype.isPrimaryField = function(field){
	if (!Scholar.Object.primaryFields){
		Scholar.Object.primaryFields = Scholar.DB.getColumnHash('objects');
		Scholar.Object.primaryFields['firstCreator'] = true;
		Scholar.Object.primaryFields['parentFolderID'] = true;
		Scholar.Object.primaryFields['orderIndex'] = true;
	}
	
	return !!Scholar.Object.primaryFields[field];
}

Scholar.Object.editableFields = {
	title: true,
	source: true,
	rights: true
};

/*
 * Check if the specified primary field can be changed with setField()
 */
Scholar.Object.prototype.isEditableField = function(field){
	return !!Scholar.Object.editableFields[field];
}


/*
 * Build object from database
 */
Scholar.Object.prototype.loadFromID = function(id){
	var sql = 'SELECT O.*, lastName AS firstCreator, TS.parentFolderID, '
		+ 'TS.orderIndex '
		+ 'FROM objects O '
		+ 'LEFT JOIN treeStructure TS ON (O.objectID=TS.id AND isFolder=0) '
		+ 'LEFT JOIN objectCreators OC ON (O.objectID=OC.objectID) '
		+ 'LEFT JOIN creators C ON (OC.creatorID=C.creatorID) '
		+ 'WHERE objectID=' + id + ' AND OC.orderIndex=0';
	var row = Scholar.DB.rowQuery(sql);
	this.loadFromRow(row);
}


/*
 * Populate basic object data from a database row
 */
Scholar.Object.prototype.loadFromRow = function(row){
	this._init();
	for (col in row){
		if (this.isPrimaryField(col) || col=='firstCreator'){
			this._data[col] = row[col];
		}
	}
	return true;
}


/*
 * Check if any data fields have changed since last save
 */
Scholar.Object.prototype.hasChanged = function(){
	return (this._changed.length || this._changedCreators.length ||
		this._changedObjectData.length);
}


Scholar.Object.prototype.getID = function(){
	return this._data['objectID'] ? this._data['objectID'] : false;
}


Scholar.Object.prototype.getType = function(){
	return this._data['objectTypeID'] ? this._data['objectTypeID'] : false;
}


Scholar.Object.prototype.getParent = function(){
	return this._data['parentFolderID'] ? this._data['parentFolderID'] : false;
}


/*
 * Set or change the object's type
 */
Scholar.Object.prototype.setType = function(objectTypeID){
	if (objectTypeID==this.getType()){
		return true;
	}
	
	// If existing type, clear fields from old type that aren't in new one
	if (this.getType()){
		var sql = 'SELECT fieldID FROM objectTypeFields '
			+ 'WHERE objectTypeID=' + this.getType() + ' AND fieldID NOT IN '
			+ '(SELECT fieldID FROM objectTypeFields WHERE objectTypeID='
			+ objectTypeID + ')';
		var obsoleteFields = Scholar.DB.columnQuery(sql);
		
		if (obsoleteFields){
			for (var i=0; i<obsoleteFields.length; i++){
				this.setField(obsoleteFields[i],false);
			}
		}
	}
	
	this._data['objectTypeID'] = objectTypeID;
	this._changed.set('objectTypeID');
	return true;
}


/*
 * Returns the number of creators for this object
 */
Scholar.Object.prototype.numCreators = function(){
	if (this.getID() && !this._creatorsLoaded){
		this._loadCreators();
	}
	return this._creators.length;
}

/*
 * Returns an array of the creator data at the given position, or false if none
 */
Scholar.Object.prototype.getCreator = function(pos){
	if (this.getID() && !this._creatorsLoaded){
		this._loadCreators();
	}
	
	if (!this._creators.items[pos]){
		return false;
	}
	return this._creators.items[pos];
}


/*
 * Set or update the creator at the specified position
 */
Scholar.Object.prototype.setCreator = function(orderIndex, firstName, lastName, creatorTypeID){
	if (this.getID() && !this._creatorsLoaded){
		this._loadCreators();
	}
	
	if (!creatorTypeID){
		creatorTypeID = 1;
	}
	
	if (!firstName && !lastName){
		throw ('Name not provided for creator');
	}
	
	if (this._creators.has(orderIndex) &&
		this._creators.get(orderIndex)['firstName']==firstName &&
		this._creators.get(orderIndex)['lastName']==lastName &&
		this._creators.get(orderIndex)['creatorTypeID']==creatorTypeID){
		return true;
	}
	
	var creator = new Array();
	creator['firstName'] = firstName;
	creator['lastName'] = lastName;
	creator['creatorTypeID'] = creatorTypeID;
	
	this._creators.set(orderIndex, creator);
	this._changedCreators.set(orderIndex);
	return true;
}


/*
 * Remove a creator and shift others down
 */
Scholar.Object.prototype.removeCreator = function(orderIndex){
	if (this.getID() && !this._creatorsLoaded){
		this._loadCreators();
	}
	
	if (!this._creators.has(orderIndex)){
		throw ('No creator exists at position ' + orderIndex);
	}
	this._creators.remove(orderIndex);
	
	for (var i=orderIndex,len=this._creators.length; i<=len; i++){
		var next =
			this._creators.items[i+1] ? this._creators.items[i+1] : false;
		this._creators.set(i, next);
		this._changedCreators.set(i);
	}
	return true;
}


/*
 * Retrieves (and loads from DB, if necessary) an objectData field value
 *
 * Field can be passed as fieldID or fieldName
 */
Scholar.Object.prototype.getField = function(field){
	//Scholar.debug('Requesting field ' + field + ' for object ' + this.getID(), 4);
	if (this.isPrimaryField(field)){
		return this._data[field] ? this._data[field] : '';
	}
	else {
		if (this.getID() && !this._objectDataLoaded){
			this._loadObjectData();
		}
		
		var fieldID = Scholar.ObjectFields.getID(field);
		
		return this._objectData[fieldID] ? this._objectData[fieldID] : '';
	}
}


/*
 * Set a field value, loading existing objectData first if necessary
 *
 * Field can be passed as fieldID or fieldName
 */
Scholar.Object.prototype.setField = function(field, value, loadIn){
	// Primary field
	if (this.isPrimaryField(field)){
		if (!this.isEditableField(field)){
			throw ('Primary field ' + field + ' cannot be changed through ' +
				'setField');
		}
		
		if (this._data[field] && this._data[field]==value){
			return false;
		}
		this._data[field] = value;
		this._changed.set(field);
		return true;
	}
	// Type-specific field
	else {
		if (!this.getType()){
			throw ('Object type must be set before setting field data.');
		}
		
		// If existing object, load field data first unless we're already in
		// the middle of a load
		if (this.getID() && !loadIn && !this._objectDataLoaded){
			this._loadObjectData();
		}
		
		var fieldID = Scholar.ObjectFields.getID(field);
		
		if (!fieldID){
			throw (field + ' is not a valid objectData field.');
		}
		
		if (!Scholar.ObjectFields.isValidForType(fieldID, this.getType())){
			throw (field + ' is not a valid field for this type.');
		}
		
		// If existing value, make sure it's actually changing
		if (this._objectData[fieldID] && this._objectData[fieldID]==value){
			return false;
		}
		this._objectData[fieldID] = value;
		if (!loadIn){
			this._changedObjectData.set(fieldID);
		}
		return true;
	}
}


/*
 * Move object to new position and shift surrounding objects
 *
 * N.B. Unless isNew is set, this function updates the DB immediately and
 * reloads all cached objects -- a save() is not required
 *
 * If isNew is true, a transaction is not started or committed, so it
 * should only be run from an existing transaction within save()
 */
Scholar.Object.prototype.setPosition = function(newFolder, newPos, isNew){
	var oldFolder = this.getField('parentFolderID');
	var oldPos = this.getField('orderIndex');
	
	if (this.getID()){
		if (newFolder==oldFolder && newPos==oldPos){
			return true;
		}
		
		if (!isNew){
			Scholar.DB.beginTransaction();
		}
		
		// If no position provided, drop at end of folder
		if (!newPos){
			newPos = Scholar.DB.valueQuery('SELECT MAX(orderIndex)+1 FROM ' +
				'treeStructure WHERE parentFolderID=' + newFolder);
		}
		// Otherwise shift down above it in old folder and shift up at it or
		// above it in new folder
		else {
			sql = 'UPDATE treeStructure SET orderIndex=orderIndex-1 ' +
				'WHERE parentFolderID=' + oldFolder +
				' AND orderIndex>' + oldPos + ";\n";
		
			sql += 'UPDATE treeStructure SET orderIndex=orderIndex+1 ' +
				'WHERE parentFolderID=' + newFolder +
				' AND orderIndex>=' + newPos + ";\n";
				
			Scholar.DB.query(sql);
		}
		
		// If a new object, insert
		if (isNew){
			sql = 'INSERT INTO treeStructure SET id=' + this.getID() + ', ' +
				'isFolder=0, orderIndex=' + newPos + ', ' +
				'parentFolderID=' + newFolder;
		}
		// Otherwise update
		else {
			sql = 'UPDATE treeStructure SET parentFolderID=' + newFolder +
				', orderIndex=' + newPos + ' WHERE id=' + this.getID() +
				" AND isFolder=0;\n";
		}
		Scholar.DB.query(sql);
		
		if (!isNew){
			Scholar.DB.commitTransaction();
		}
	}
	
	this._data['parentFolderID'] = newFolder;
	this._data['orderIndex'] = newPos;
	
	if (!isNew){
		Scholar.Objects.reloadAll();
	}
	return true;
}


/*
 * Save changes back to database
 */
Scholar.Object.prototype.save = function(){
	if (!this.hasChanged()){
		Scholar.debug('Object ' + this.getID() + ' has not changed', 4);
		return !!this.getID();
	}
	
	//
	// Existing object, update
	//
	if (this.getID()){
		Scholar.debug('Updating database with new object data', 4);
		
		var objectID = this.getID();
		
		try {
			Scholar.DB.beginTransaction();
			
			//
			// Primary fields
			//
			var sql = "UPDATE objects SET ";
			var sql2;
			
			if (this._changed.has('objectTypeID')){
				sql += "objectTypeID='" +  this.getField('objectTypeID') + "', ";
			}
			if (this._changed.has('title')){
				sql += "title='" +  this.getField('title') + "', ";
			}
			if (this._changed.has('source')){
				sql += "source='" +  this.getField('source') + "', ";
			}
			if (this._changed.has('rights')){
				sql += "rights='" +  this.getField('rights') + "', ";
			}
			
			// Always update modified time
			sql += "dateModified=CURRENT_TIMESTAMP ";
			sql += "WHERE objectID=" + this.getID() + ";\n";
			
			
			//
			// Creators
			//
			if (this._changedCreators.length){
				for (orderIndex in this._changedCreators.items){
					Scholar.debug('Creator ' + orderIndex + ' has changed', 4);
					
					var creator = this.getCreator(orderIndex);
					
					// If empty, delete at position and shift down any above it
					//
					// We have to do this immediately so old entries are
					// cleared before other ones are shifted down
					if (!creator['firstName'] && !creator['lastName']){
						sql2 = 'DELETE FROM objectCreators '
							+ ' WHERE objectID=' + this.getID()
							+ ' AND orderIndex=' + orderIndex;
						Scholar.DB.query(sql2);
						continue;
					}
					
					// See if this is an existing creator
					var creatorID = Scholar.Creators.getID(
							creator['firstName'],
							creator['lastName'],
							creator['creatorTypeID']
					);
					
					// If not, add it
					if (!creatorID){
						creatorID = Scholar.Creators.add(
							creator['firstName'],
							creator['lastName'],
							creator['creatorTypeID']
						);
					}
					
					
					sql2 = 'SELECT COUNT(*) FROM objectCreators'
						+ ' WHERE objectID=' + this.getID()
						+ ' AND orderIndex=' + orderIndex;
					
					if (Scholar.DB.valueQuery(sql2)){
						sql += 'UPDATE objectCreators SET creatorID='
							+ creatorID + ' WHERE objectID=' + this.getID()
							+ ' AND orderIndex=' + orderIndex + ";\n";
					}
					else {
						sql += 'INSERT INTO objectCreators VALUES ('
							+ creatorID + ',' + objectID + ',' + orderIndex
							+ ");\n";
					}
				}
				
				// Append the SQL to delete obsolete creators
				sql += Scholar.Creators.purge(true) + "\n";
			}
			
			
			//
			// ObjectData
			//
			if (this._changedObjectData.length){
				var del = new Array();
				for (fieldID in this._changedObjectData.items){
					if (this.getField(fieldID)){
						// Oh, for an INSERT...ON DUPLICATE KEY UPDATE
						sql2 = 'SELECT COUNT(*) FROM objectData '
							+ 'WHERE objectID=' + this.getID()
							+ ' AND fieldID=' + fieldID;
						
						if (Scholar.DB.valueQuery(sql2)){
							sql += "UPDATE objectData SET value=";
							// Take advantage of SQLite's manifest typing
							if (Scholar.ObjectFields.isInteger(fieldID)){
								sql += this.getField(fieldID);
							}
							else {
								sql += "'" + this.getField(fieldID) + "'";
							}
							sql += " WHERE objectID=" + this.getID()
								+ ' AND fieldID=' + fieldID + ";\n";
						}
						else {
							sql += 'INSERT INTO objectData VALUES ('
								+ this.getID() + ',' + fieldID + ',';
								
							if (Scholar.ObjectFields.isInteger(fieldID)){
								sql += this.getField(fieldID);
							}
							else {
								sql += "'" + this.getField(fieldID) + "'";
							}
							sql += ");\n";
						}
					}
					// If field changed and is empty, mark row for deletion
					else {
						del.push(fieldID);
					}
				}
				
				// Delete blank fields
				if (del.length){
					sql += 'DELETE from objectData '
						+ 'WHERE objectID=' + this.getID() + ' '
						+ 'AND fieldID IN (' + del.join() + ");\n";
				}
			}
			
			
			Scholar.DB.query(sql);
			Scholar.DB.commitTransaction();
		}
		catch (e){
			Scholar.DB.rollbackTransaction();
			throw (e);
		}
	}
	
	//
	// New object, insert and return id
	//
	else {
		Scholar.debug('Saving data for new object to database');
		
		var isNew = true;
		var sqlColumns = new Array();
		var sqlValues = new Array();
		
		//
		// Primary fields
		//
		sqlColumns.push('objectTypeID');
		sqlValues.push({'int':this.getField('objectTypeID')});
		
		if (this._changed.has('title')){
			sqlColumns.push('title');
			sqlValues.push({'string':this.getField('title')});
		}
		if (this._changed.has('source')){
			sqlColumns.push('source');
			sqlValues.push({'string':this.getField('source')});
		}
		if (this._changed.has('rights')){
			sqlColumns.push('rights');
			sqlValues.push({'string':this.getField('rights')});
		}
		
		try {
			Scholar.DB.beginTransaction();
			
			//
			// Creators
			//
			if (this._changedCreators.length){
				for (orderIndex in this._changedCreators.items){
					var creator = this.getCreator(orderIndex);
					
					// If empty, skip
					if (typeof creator['firstName'] == 'undefined'
						&& typeof creator['lastName'] == 'undefined'){
						continue;
					}
					
					// See if this is an existing creator
					var creatorID = Scholar.Creators.getID(
							creator['firstName'],
							creator['lastName'],
							creator['creatorTypeID']
					);
					
					// If not, add it
					if (!creatorID){
						creatorID = Scholar.Creators.add(
							creator['firstName'],
							creator['lastName'],
							creator['creatorTypeID']
						);
					}
					
					sql += 'INSERT INTO objectCreators VALUES ('
						+ creatorID + ',' + objectID + ',' + orderIndex
						+ ");\n";
				}
			}
			
			
			//
			// objectData fields
			//
			var sql = "INSERT INTO objects (" + sqlColumns.join() + ')'
				+ ' VALUES (';
			// Insert placeholders for bind parameters
			for (var i=0; i<sqlValues.length; i++){
				sql += '?,';
			}
			sql = sql.substring(0,sql.length-1) + ");\n";
			
			var objectID = Scholar.DB.query(sql,sqlValues);
			
			if (this._changedObjectData.length){
				sql = '';
				for (fieldID in this._changedObjectData.items){
					sql += 'INSERT INTO objectData VALUES (' +
						objectID + ',' + fieldID + ',';
						if (Scholar.ObjectFields.isInteger(fieldID)){
							sql += this.getField(fieldID);
						}
						else {
							sql += "'" + this.getField(fieldID) + "'";
						}
						sql += ");\n";
				}
			}
			
			
			
			Scholar.DB.query(sql);
			
			
			// Set the position of the new object
			var newFolder = this._changed.has('parentFolderID')
				? this.getField('parentFolderID') : 0;
			
			var newPos = this._changed.has('orderIndex')
				? this.getField('orderIndex') : false;
			
			this.setPosition(newFolder, newPos, true);
			
			// TODO: reload Folder or set the empty flag to false manually
			// in case this was the first object in a folder
			
			Scholar.DB.commitTransaction();
		}
		catch (e){
			Scholar.DB.rollbackTransaction();
			throw (e);
		}
	}
	
	Scholar.Objects.reload(this.getID());
	
	return isNew ? this.getID() : true;
}


Scholar.Object.prototype.toString = function(){
	return this.getTitle();
}


Scholar.Object.prototype.isFolder = function(){
	return false;
}


//////////////////////////////////////////////////////////////////////////////
//
// Private Scholar.Object methods
//
//////////////////////////////////////////////////////////////////////////////

/*
 * Load in the creators from the database
 */
Scholar.Object.prototype._loadCreators = function(){
	if (!this.getID()){
		throw ('ObjectID not set for object before attempting to load creators');
	}
	
	var sql = 'SELECT C.creatorID, C.*, orderIndex FROM objectCreators OC '
		+ 'LEFT JOIN creators C USING (creatorID) '
		+ 'WHERE objectID=' + this.getID() + ' ORDER BY orderIndex';
	var creators = Scholar.DB.query(sql);
	
	this._creatorsLoaded = true;
	
	if (!creators){
		return true;
	}
	
	this._creators = new Scholar.Hash();
	for (var i=0; i<creators.length; i++){
		var creator = new Array();
		creator['firstName'] = creators[i]['firstName'];
		creator['lastName'] = creators[i]['lastName'];
		creator['creatorTypeID'] = creators[i]['creatorTypeID'];
		this._creators.set(creators[i]['orderIndex'], creator);
	}
	
	return true;
}


/*
 * Load in the field data from the database
 */
Scholar.Object.prototype._loadObjectData = function(){
	if (!this.getID()){
		throw ('ObjectID not set for object before attempting to load data');
	}
	
	var sql = 'SELECT OD.fieldID, value FROM objectData OD JOIN '
		+ 'objectTypeFields OTF ON (OTF.objectTypeID=(SELECT objectTypeID FROM '
		+ 'objects WHERE objectID=?1) AND OTF.fieldID=OD.fieldID) '
		+ 'WHERE objectID=?1 ORDER BY orderIndex';
		
	var result = Scholar.DB.query(sql,[{'int':this._data['objectID']}]);
	
	this._objectDataLoaded = true;
	
	if (result){
		for (var i=0,len=result.length; i<len; i++){
			this.setField(result[i]['fieldID'], result[i]['value'], true);
		}
		return true;
	}
	else {
		return false;
	}
}





/*
 * Primary interface for accessing Scholar objects
 */
Scholar.Objects = new function(){
	// Private members
	var _objects = new Array();
	
	// Privileged methods
	this.get = get;
	this.getAll = getAll;
	this.getTreeRows = getTreeRows;
	this.reload = reload;
	this.reloadAll = reloadAll;
	
	/*
	 * Retrieves (and loads, if necessary) an arbitrary number of objects
	 *
	 * Can be passed ids as individual parameters or as an array of ids, or both
	 *
	 * If only one argument and it's an id, return object directly;
	 * otherwise, return array indexed by objectID
	 */
	function get(){
		var toLoad = new Array();
		var loaded = new Array();
		
		if (!arguments[0]){
			return false;
		}
		
		var ids = Scholar.flattenArguments(arguments);
		
		for (var i=0; i<ids.length; i++){
			// Check if already loaded
			if (!_objects[ids[i]]){
				toLoad.push(ids[i]);
			}
		}
		
		// New objects to load
		if (toLoad.length){
			_load(toLoad);
		}
		
		// If single id, return the object directly
		if (arguments[0] && typeof arguments[0]!='Object'
				&& typeof arguments[1]=='undefined'){
			return _objects[arguments[0]];
		}
		
		// Otherwise, build return array
		for (i=0; i<ids.length; i++){
			loaded[ids[i]] = _objects[ids[i]];
		}
	
		return loaded;
	}
	
	
	/*
	 * Returns all objects in the database
	 */
	function getAll(){
		var sql = 'SELECT O.objectID FROM objects O '
			+ 'LEFT JOIN treeStructure TS ON (O.objectID=TS.id AND isFolder=0) '
			+ 'ORDER BY orderIndex';
		
		var ids = Scholar.DB.columnQuery(sql);
		return this.get(ids);
	}
	
	
	/*
	 * Returns an array of all folders and objects that are children of a folder
	 * as Scholar.Folder and Scholar.Object instances
	 *
	 * Takes parent folderID as optional parameter; by default, returns root items
	 *
	 * Type can tested with instanceof (e.g. if (obj instanceof Scholar.Folder)) or isFolder()
	 */
	function getTreeRows(parent){
		var toReturn = new Array();
		
		/*
		// To return all items (no longer used)
		var sql = 'SELECT * FROM treeStructure WHERE id>0 ORDER BY orderIndex';
		*/
		
		if (!parent){
			parent = 0;
		}
		
		var sql = 'SELECT * FROM treeStructure TS '
			+ 'WHERE parentFolderID=' + parent + ' ORDER BY orderIndex';
		
		var tree = Scholar.DB.query(sql);
		
		if (!tree){
			Scholar.debug('No children of folder ' + parent, 5);
			return toReturn;
		}
		
		_load('all');
		
		for (var i=0, len=tree.length; i<len; i++){
			if (parseInt(tree[i]['isFolder'])){
				var obj = Scholar.Folders.get(tree[i]['id']);
				if (!obj){
					throw ('Folder ' + tree[i]['id'] + ' not found');
				}
			}
			else {
				var obj = Scholar.Objects.get(tree[i]['id']);
				if (!obj){
					throw ('Object ' + tree[i]['id'] + ' not found');
				}
			}
			
			toReturn.push(obj);
		}
		
		return toReturn;
	}
	 
	
	/*
	 * Reloads data for specified objects into internal array
	 *
	 * Can be passed ids as individual parameters or as an array of ids, or both
	 */
	function reload(){
		if (!arguments[0]){
			return false;
		}
		
		var ids = Scholar.flattenArguments(arguments);
		Scholar.debug('Reloading ' + ids);
		_load(ids);
		
		return true;
	}
	
	
	/*
	 * Reloads all currently cached objects
	 */
	function reloadAll(){
		var ids = new Array();
		for (objectID in _objects){
			ids.push(objectID);
		}
		_load(ids);
		return true;
	}
	
	
	function add(data, objectTypeID, folderID, orderIndex){
		var insert = new Array();
		
		var obj = new Scholar.Object(objectTypeID, folderID, orderIndex);
		
		for (field in data){
			obj.setField(data[field]);
		}
		
		var id = obj.save();
		
		return this.get(id);
	}
	
	
	function _load(){
		if (!arguments){
			return false;
		}
		
		// Should be the same as query in Scholar.Object.loadFromID, just
		// without objectID clause
		var sql = 'SELECT O.*, lastName AS firstCreator, TS.parentFolderID, '
			+ 'TS.orderIndex '
			+ 'FROM objects O '
			+ 'LEFT JOIN treeStructure TS ON (O.objectID=TS.id AND isFolder=0) '
			+ 'LEFT JOIN objectCreators OC ON (O.objectID=OC.objectID) '
			+ 'LEFT JOIN creators C ON (OC.creatorID=C.creatorID) '
			+ 'WHERE OC.orderIndex=0';
		
		if (arguments[0]!='all'){
			sql += ' AND O.objectID IN (' + Scholar.join(arguments,',') + ')';
		}
		
		var result = Scholar.DB.query(sql);
		
		if (result){
			for (var i=0,len=result.length; i<len; i++){
				var obj = new Scholar.Object();
				obj.loadFromRow(result[i]);
				_objects[result[i]['objectID']] = obj;
			}
		}
		return true;
	}
}





/*
 * Constructor for Folder object
 *
 * Generally should be called from Scholar.Folders rather than directly
 */
Scholar.Folder = function(){
	this._id;
	this._name;
	this._parent;
}


/*
 * Build folder from database
 */
Scholar.Folder.prototype.loadFromID = function(id){
	// Should be same as query in Scholar.Folders, just with folderID
	var sql = "SELECT folderID, folderName, parentFolderID, "
		+ "(SELECT COUNT(*) FROM treeStructure WHERE parentFolderID=" +
		id + ")=0 AS isEmpty FROM folders F "
		+ "JOIN treeStructure TS ON (F.folderID=TS.id AND TS.isFolder=1) "
		+ "WHERE folderID=" + id;
	
	var row = Scholar.DB.rowQuery(sql);
	this.loadFromRow(row);
}


/*
 * Populate folder data from a database row
 */
Scholar.Folder.prototype.loadFromRow = function(row){
	this._id = row['folderID'];
	this._name = row['folderName'];
	this._parent = row['parentFolderID'];
	this._empty = row['isEmpty'];
}

Scholar.Folder.prototype.getID = function(){
	return this._id;
}

Scholar.Folder.prototype.getName = function(){
	return this._name;
}

Scholar.Folder.prototype.isFolder = function(){
	return true;
}

Scholar.Folder.prototype.getParent = function(){
	return this._parent;
}

Scholar.Folder.prototype.isEmpty = function(){
	return !!parseInt(this._empty);
}


/*
 * Primary interface for accessing Scholar folders
 */
Scholar.Folders = new function(){
	var _folders = new Array();
	var _foldersLoaded = false;
	
	this.get = get;
	
	/*
	 * Returns a Scholar.Folder object for a folderID
	 */
	function get(id){
		if (!_foldersLoaded){
			_load();
		}
		return (typeof _folders[id]!='undefined') ? _folders[id] : false;
	}
	
	
	function _load(){
		var sql = "SELECT folderID, folderName, parentFolderID, "
			+ "(SELECT COUNT(*) FROM treeStructure WHERE "
			+ "parentFolderID=TS.id)=0 AS isEmpty FROM folders F "
			+ "JOIN treeStructure TS ON (F.folderID=TS.id AND TS.isFolder=1) "
			+ "WHERE folderID>0"; // skip 'root' folder
		var result = Scholar.DB.query(sql);
		
		if (!result){
			throw ('No folders exist');
		}
		
		for (var i=0; i<result.length; i++){
			var folder = new Scholar.Folder();
			folder.loadFromRow(result[i]);
			_folders[folder.getID()] = folder;
		}
		_foldersLoaded = true;
	}
}





Scholar.Creators = new function(){
	var _creators = new Array; // indexed by first%%%last%%%creatorTypeID hash
	var _creatorsByID = new Array; // indexed by creatorID
	
	this.get = get;
	this.getID = getID;
	this.add = add;
	this.purge = purge;
	
	/*
	 * Returns an array of creator data for a given creatorID
	 */
	function get(creatorID){
		if (_creatorsByID[creatorID]){
			return _creatorsByID[creatorID];
		}
		
		var sql = 'SELECT * FROM creators WHERE creatorID=' + creatorID;
		var result = Scholar.DB.rowQuery(sql);
		
		if (!result){
			return false;
		}
		
		_creatorsByID[creatorID] = result;
		return result;
	}
	
	
	/*
	 * Returns the creatorID matching given name and type
	 */
	function getID(firstName, lastName, creatorTypeID){
		var hash = firstName + '%%%' + lastName + '%%%' + creatorTypeID;
		
		if (_creators[hash]){
			return _creators[hash];
		}
		
		var sql = 'SELECT creatorID FROM creators WHERE firstName=? AND '
			+ 'lastName=? AND creatorTypeID=?';
		var params = [
			{'string': firstName}, {'string': lastName}, {'int': creatorTypeID}
		];
		var creatorID = Scholar.DB.valueQuery(sql,params);
		
		if (creatorID){
			_creators[hash] = creatorID;
		}
		
		return creatorID;
	}
	
	
	/*
	 * Add a new creator to the database
	 *
	 * Returns new creatorID
	 */
	function add(firstName, lastName, creatorTypeID){
		Scholar.debug('Adding new creator', 4);
		
		var sql = 'INSERT INTO creators '
			+ 'VALUES (?,?,?,?)';
		
		// Use a random integer for the creatorID
		var tries = 10; // # of tries to find a unique id
		var max = 65535;
		do {
			// If no luck after 10 tries, try a larger range
			if (!tries){
				tries = 10;
				max = max * 10;
			}
			var rnd = Math.floor(Math.random()*max);
			var sql2 = 'SELECT COUNT(*) FROM creators WHERE creatorID=' + rnd;
			var exists = Scholar.DB.valueQuery(sql2);
			tries--;
		}
		while (exists);
		
		var params = [
			{'int': rnd}, {'int': creatorTypeID},
			{'string': firstName}, {'string': lastName},
		];
		return Scholar.DB.query(sql,params);
	}
	
	
	/*
	 * Delete obsolete creators from database and clear internal array entries
	 *
	 * Returns TRUE on success, or SQL query to run in returnSQL mode
	 */
	function purge(returnSQL){
		var sql = 'SELECT creatorID FROM creators WHERE creatorID NOT IN '
			+ '(SELECT creatorID FROM objectCreators);';
		var toDelete = Scholar.DB.columnQuery(sql);
		
		if (!toDelete){
			return false;
		}
		
		sql = 'DELETE FROM creators WHERE creatorID NOT IN '
			+ '(SELECT creatorID FROM objectCreators);';
		
		if (!returnSQL){
			var result = Scholar.DB.query(sql);
		}
		
		// Clear creator entries in internal array
		for (var i=0; i<toDelete.length; i++){
			var hash = _getHash(toDelete[i]);
			delete _creators[hash];
			delete _creatorsByID[toDelete[i]];
		}
		
		return returnSQL ? sql : result;
	}
	
	
	function _getHash(creatorID){
		var creator = this.get(creatorID);
		if (!creator){
			return false;
		}
		return creator['firstName'] + '%%%' + creator['lastName']
			+ '%%%' + creator['creatorTypeID'];
	}
}






Scholar.ObjectFields = new function(){
	// Private members
	var _fields = new Array();
	var _fieldFormats = new Array();
	var _objectTypeFields = new Array();
	
	// Privileged methods
	this.getName = getName;
	this.getID = getID;
	this.isValidForType = isValidForType;
	this.isInteger = isInteger;
	this.getObjectTypeFields = getObjectTypeFields;
	
	/*
	 * Return the fieldName for a passed fieldID or fieldName
	 */
	function getName(field){
		if (!_fields.length){
			_loadFields();
		}
		return _fields[field] ? _fields[field]['name'] : false;
	}
	
	
	/*
	 * Return the fieldID for a passed fieldID or fieldName
	 */
	function getID(field){
		if (!_fields.length){
			_loadFields();
		}
		return _fields[field] ? _fields[field]['id'] : false;
	}
	
	
	function isValidForType(fieldID, objectTypeID){
		if (!_fields.length){
			_loadFields();
		}
		return !!_fields[fieldID]['objectTypes'][objectTypeID];
	}
	
	
	function isInteger(fieldID){
		if (!_fields.length){
			_loadFields();
		}
		var ffid = _fields[fieldID]['formatID'];
		return _fieldFormats[ffid] ? _fieldFormats[ffid]['isInteger'] : false;
	}
	
	
	/*
	 * Returns an array of fieldIDs for a given object type
	 */
	function getObjectTypeFields(objectTypeID){
		if (_objectTypeFields[objectTypeID]){
			return _objectTypeFields[objectTypeID];
		}
		
		var sql = 'SELECT fieldID FROM objectTypeFields '
			+ 'WHERE objectTypeID=' + objectTypeID + ' ORDER BY orderIndex';
		
		_objectTypeFields[objectTypeID] = Scholar.DB.columnQuery(sql);
		return _objectTypeFields[objectTypeID];
	}
	
	
	/*
	 * Returns hash array of objectTypeIDs for which a given field is valid
	 */
	function _getFieldObjectTypes(){
		var sql = 'SELECT fieldID,objectTypeID FROM objectTypeFields';
		
		var results = Scholar.DB.query(sql);
		
		if (!results){
			throw ('No fields in objectTypeFields!');
		}
		var fields = new Array();
		for (var i=0; i<results.length; i++){
			if (!fields[results[i]['fieldID']]){
				fields[results[i]['fieldID']] = new Array();
			}
			fields[results[i]['fieldID']][results[i]['objectTypeID']] = true;
		}
		return fields;
	}
	
	
	/*
	 * Load all fields into an internal hash array
	 */
	function _loadFields(){
		var i,len;
		
		var result = Scholar.DB.query('SELECT * FROM fieldFormats');
		
		for (i=0; i<result.length; i++){
			_fieldFormats[result[i]['fieldFormatID']] = {
				regex: result[i]['regex'],
				isInteger: result[i]['isInteger']
			};
		}
		
		result = Scholar.DB.query('SELECT * FROM fields');
		
		if (!result.length){
			throw ('No fields in database!');
		}
		
		var fieldObjectTypes = _getFieldObjectTypes();
		
		for (i=0,len=result.length; i<len; i++){
			_fields[result[i]['fieldID']] = {
				id: result[i]['fieldID'],
				name: result[i]['fieldName'],
				formatID: result[i]['fieldFormatID'],
				objectTypes: fieldObjectTypes[result[i]['fieldID']]
			};
			// Store by name as well as id
			_fields[result[i]['fieldName']] = _fields[result[i]['fieldID']];
		}
	}
}

/*
var objects = Scholar.Objects.getAll();

var obj = objects[9];
for (var i=0,len=obj.numCreators(); i<len; i++){
	Scholar.debug(Scholar.varDump(obj.getCreator(i)));
}

obj.setCreator(2,'bob','smith');

for (var i=0,len=obj.numCreators(); i<len; i++){
	Scholar.debug(Scholar.varDump(obj.getCreator(i)));
}
obj.save();
*/
