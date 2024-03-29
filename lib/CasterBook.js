/*
	Spellcast's Caster Extension

	Copyright (c) 2014 - 2020 Cédric Ronvel

	The MIT License (MIT)

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

"use strict" ;



const extension = require( './extension.js' ) ;

const casterPackage = require( '../package.json' ) ;
const utils = extension.host.exports.utils ;

const Role = extension.host.exports.Role ;
const Ctx = extension.host.exports.Ctx ;

const fs = require( 'fs' ) ;
const path = require( 'path' ) ;
const chokidar = require( 'chokidar' ) ;
const minimatch = extension.host.exports.minimatch ;
const glob = extension.host.exports.glob ;
const doormen = extension.host.exports.doormen ;

const Promise = extension.host.exports.Promise ;

const kungFig = extension.host.exports.kungFig ;
const Ngev = extension.host.exports.Ngev ;
const Babel = extension.host.exports.Babel ;

const availableTags = require( './tags/tags.js' ).caster ;

const CastTag = require( './tags/caster/CastTag.js' ) ;
const SummonTag = require( './tags/caster/SummonTag.js' ) ;

const Book = extension.host.exports.Book ;

//const Logfella = require( 'logfella' ) ;
const log = extension.host.api.log.use( 'spellcast-caster' ) ;



function CasterBook( script , options ) {
	if ( ! options || typeof options !== 'object' ) { options = {} ; }

	Book.call( this , script , options ) ;

	this.type = 'caster' ;
	this.wands = {} ;
	this.activePrologue = null ;
	this.activeEpilogue = null ;
	this.spells = {} ;
	this.summonings = {} ;
	this.wildSummonings = [] ;
	this.reverseSummonings = [] ;

	// Undead mode
	this.isIdle = true ;
	this.undeadMode = false ;
	this.undeadWatchers = {} ;
	this.undeadRespawnTime = 500 ;
	this.undeadRespawnTimer = null ;
	this.undeadRespawnMap = {} ;
	this.undeadBoundFn = null ;

	this.onFsWatchEvent = CasterBook.onFsWatchEvent.bind( this ) ;
	this.onUndeadRaised = CasterBook.onUndeadRaised.bind( this ) ;
}

CasterBook.prototype = Object.create( Book.prototype ) ;
CasterBook.prototype.constructor = CasterBook ;

module.exports = CasterBook ;



CasterBook.load = async function( bookPath , options ) {
	var regex , script ;

	if ( ! options || typeof options !== 'object' ) { options = {} ; }

	options.type = 'caster' ;

	if ( ! options.cwd ) {
		// Set the CWD for commands, summonings, and persistent
		if ( path.isAbsolute( bookPath ) ) {
			options.cwd = path.dirname( bookPath ) ;
		}
		else {
			options.cwd = process.cwd() + '/' + path.dirname( bookPath ) ;
		}
	}

	if ( ! options.data ) { options.data = {} ; }

	if ( ! options.data.__babel ) {
		regex = /(\^)/g ;
		regex.substitution = '$1$1' ;
		Object.defineProperty( options.data , '__babel' , { value: new Babel( regex ) , writable: true } ) ;
	}

	if ( ! options.locales ) { options.locales = {} ; }


	script = await kungFig.loadAsync( bookPath , {
		kfgFiles: {
			basename: [ 'spellbook' , 'book' ]
		} ,
		doctype: 'spellcast/spellbook' ,
		metaTagsHook: ( meta , parseOptions ) => {
			var localesMeta , assetsMeta , locale ;

			localesMeta = meta.getFirstTag( 'locales' ) ;
			assetsMeta = meta.getFirstTag( 'assets' ) ;

			if ( localesMeta ) {
				glob.sync( path.dirname( parseOptions.file ) + '/' + localesMeta.attributes , { absolute: true } ).forEach( e => {
					locale = path.basename( e , '.kfg' ) ;
					if ( ! Array.isArray( options.locales[ locale ] ) ) { options.locales[ locale ] = [] ; }
					options.locales[ locale ].push( e ) ;
				} ) ;
			}

			if ( assetsMeta ) {
				if (
					path.isAbsolute( assetsMeta.attributes ) ||
					assetsMeta.attributes[ 0 ] === '~' ||
					assetsMeta.attributes.indexOf( '..' ) !== -1
				) {
					// For security sake...
					throw new Error( "Asset tag's path should be relative to the book and should not contain any '../'" ) ;
				}

				options.assetBaseUrl = fs.realpathSync( path.dirname( bookPath ) + '/' + assetsMeta.attributes ) ;
				//console.log( "options.assetBaseUrl: " , options.assetBaseUrl ) ;
			}
		} ,
		operators: extension.host.exports.operators ,
		tags: availableTags
	} ) ;


	var book = new CasterBook( script , options ) ;

	return book ;
} ;



CasterBook.prototype.destroy = function() {
	if ( this.destroyed ) { return ; }
	Book.prototype.destroy.call( this ) ;
	this.stopUndeadMode() ;
} ;



CasterBook.prototype.initBook = async function( stateFile ) {
	if ( stateFile ) {
		throw new Error( "State files not supported" ) ;
	}

	this.startTask() ;

	try {
		await this.prepareDotSpellcastDirectory() ;

		// Script init
		await this.engine.initAsync( this.script , this ) ;

		// Run the top-level
		var initCtx = new Ctx( this ) ;

		await this.engine.runAsync( this.script , this , initCtx , null ) ;

		// Save the events used for init
		this.initEvents = initCtx.events ;

		// Destroy the init context now!
		initCtx.destroy() ;

		if ( ! this.roles.length ) {
			this.roles.push( new Role( 'default' , {
				name: 'main role' ,
				noChat: true
			} ) ) ;
		}

		this.emit( 'ready' ) ;
	}
	catch ( error ) {
		this.endTask() ;
		throw error ;
	}

	this.endTask() ;
} ;



var persistentJsonSchema = {
	sanitize: 'removeExtraProperties' ,
	properties: {
		version: { type: 'string' , default: casterPackage.version } ,
		summonMap: {
			properties: {
				spell: {
					type: 'strictObject' ,
					default: {}
				} ,
				summoning: {
					type: 'strictObject' ,
					default: {}
				}
			} ,
			default: { spell: {} , summoning: {} }
		}
	}
} ;



CasterBook.prototype.prepareDotSpellcastDirectory = async function() {
	var directories = [
		this.cwd + '/.spellcast' ,
		this.cwd + '/.spellcast/casted' ,
		this.cwd + '/.spellcast/fizzled' ,
		this.cwd + '/.spellcast/tmp'
	] ;

	await Promise.every( directories , async ( dirPath ) => {
		try {
			await fs.statAsync( dirPath ) ;
		}
		catch ( error ) {
			return fs.mkdirAsync( dirPath ) ;
		}
	} ) ;

	await this.loadPersistent() ;
} ;



CasterBook.prototype.loadPersistent = async function() {
	var content ;

	try {
		content = await fs.readFileAsync( this.cwd + '/.spellcast/persistent.json' , 'utf8' ) ;
	}
	catch ( error ) {
		log.verbose( "'persistent.json' not found" ) ;
		this.persistent = doormen( persistentJsonSchema , {} ) ;
		return ;
	}

	try {
		this.persistent = doormen( persistentJsonSchema , JSON.parse( content ) ) ;
	}
	catch ( error_ ) {
		log.error( "Parse 'persistent.json': %E" , error_ ) ;
		this.persistent = doormen( persistentJsonSchema , {} ) ;
	}

	if ( ! utils.isCompatible( this.persistent.version ) ) {
		log.warning(
			"'persistent.json' version (%s) is not compatible with current version (%s) and will be reset." ,
			this.persistent.version ,
			casterPackage.version
		) ;

		this.persistent = doormen( persistentJsonSchema , {} ) ;
	}

	log.debug( "'persistent.json' loaded %I" , this.persistent ) ;
} ;



CasterBook.prototype.savePersistent = async function() {
	var content ;

	try {
		//content = JSON.stringify( this.persistent ) ;
		content = JSON.stringify( this.persistent , null , '\t' ) ;
	}
	catch ( error ) {
		log.error( "Stringify 'persistent.json': %E" , error ) ;
		throw error ;
	}

	try {
		await fs.writeFileAsync( this.cwd + '/.spellcast/persistent.json' , content , 'utf8' ) ;
	}
	catch ( error ) {
		// Not found is not an error
		log.error( "Cannot save 'persistent.json': %E" , error ) ;
		throw error ;
	}

	log.debug( "'persistent.json' saved" ) ;
} ;



CasterBook.prototype.reset = function() {
	return this.resetReverseSummonings() ;
} ;



CasterBook.prototype.resetReverseSummonings = function() {
	return Promise.every( this.reverseSummonings , reverseSummoning =>  reverseSummoning.reset( this ) ) ;
} ;



CasterBook.prototype.cast = async function( spellName , options ) {
	if ( options && options.again ) { this.persistent.summoned = {} ; }

	if ( options && options.undead ) {
		this.initUndeadMode( options.undead , this.cast.bind( this , spellName , null ) ) ;
	}

	this.startTask() ;

	try {
		await CastTag.exec( this , spellName , options , null ) ;
	}
	catch ( error ) {
		log.debug( "Top level cast: %E" , error ) ;
		Ngev.groupEmit( this.clients , 'coreMessage' , '^MAll casting finished, ^rbut some spells fizzled.^:\n\n' ) ;
		this.endTask() ;
		throw error ;
	}

	await this.savePersistent() ;
	Ngev.groupEmit( this.clients , 'coreMessage' , '^MAll casting done.^:\n\n' ) ;
	this.endTask() ;
} ;



CasterBook.prototype.summon = async function( summoningName , options ) {
	if ( options && options.again ) { this.persistent.summoned = {} ; }

	if ( options && options.undead ) {
		this.initUndeadMode( options.undead , this.summon.bind( this , summoningName , null ) ) ;
	}

	this.startTask() ;

	try {
		await SummonTag.exec( this , summoningName , options , null ) ;
	}
	catch ( error ) {
		log.debug( "Top level summon: dependency failed: %E" , error ) ;
		Ngev.groupEmit( this.clients , 'coreMessage' , '^MAll summoning finished, ^rbut some summonings fizzled.^:\n\n' ) ;
		this.endTask() ;
		throw error ;
	}

	await this.savePersistent() ;
	Ngev.groupEmit( this.clients , 'coreMessage' , '^MAll summoning done.^:\n\n' ) ;
	this.endTask() ;
} ;



/* Undead Mode */



CasterBook.prototype.initUndeadMode = function( time , boundFn ) {
	Object.keys( this.undeadWatchers ).forEach( e => this.dispellUndead( e ) ) ;
	if ( typeof time === 'number' ) { this.undeadRespawnTime = time ; }
	this.undeadBoundFn = boundFn ;
	this.undeadMode = true ;
	this.on( 'undeadRaised' , this.onUndeadRaised ) ;
} ;



CasterBook.prototype.stopUndeadMode = function() {
	Object.keys( this.undeadWatchers ).forEach( e => this.dispellUndead( e ) ) ;
	this.off( 'undeadRaised' , this.onUndeadRaised ) ;
	this.undeadBoundFn = null ;
	this.undeadMode = false ;
} ;



/*
	Possible refacto: chokidar watcher supports multiple path at once.
*/
CasterBook.prototype.castUndead = function( path_ , discoveryPathObject ) {
	if ( ! this.undeadMode ) { return ; }

	if ( this.undeadWatchers[ path_ ] ) {
		if ( discoveryPathObject ) {
			if ( ! this.undeadWatchers[ path_ ].__discoveryPathObject ) { this.undeadWatchers[ path_ ].__discoveryPathObject = {} ; }
			Object.keys( discoveryPathObject ).forEach( glob_ => this.undeadWatchers[ path_ ].__discoveryPathObject[ glob_ ] = true ) ;
		}

		return ;
	}

	log.debug( "New undead: %s" , path_ ) ;

	this.undeadWatchers[ path_ ] = chokidar.watch( path_ , { ignoreInitial: true } ) ;

	if ( discoveryPathObject ) {
		this.undeadWatchers[ path_ ].__discoveryPathObject = {} ;
		Object.keys( discoveryPathObject ).forEach( glob_ => this.undeadWatchers[ path_ ].__discoveryPathObject[ glob_ ] = true ) ;
	}

	this.undeadWatchers[ path_ ].on( 'all' , this.onFsWatchEvent.bind( this , path_ ) ) ;

	this.undeadWatchers[ path_ ].on( 'error' , ( error ) => {
		log.error( "Undead watcher error: %E" , error ) ;
	} ) ;
} ;



CasterBook.prototype.dispellUndead = function( path_ ) {
	if ( ! this.undeadMode || ! this.undeadWatchers[ path_ ] ) { return ; }
	this.undeadWatchers[ path_ ].close() ;
	delete this.undeadWatchers[ path_ ] ;
} ;



CasterBook.prototype.cancelUndeadRespawn = function( path_ ) {
	log.debug( "Canceling respawn for '%s'" , path_ ) ;
	delete this.undeadRespawnMap[ path_ ] ;

	// Because of race conditions, the filesystem watch event can happened slightly after the cancel action
	setTimeout( () => {
		log.debug( "Delayed canceling respawn for '%s'" , path_ ) ;
		delete this.undeadRespawnMap[ path_ ] ;
	} , 10 ) ;
} ;



CasterBook.onFsWatchEvent = async function( watchPath , event , path_ ) {
	var i , iMax , discoveryPathObject , discoveryList , found ;

	if ( ! this.undeadMode ) { return ; }

	log.verbose( "onFsWatchEvent():\nwatchpath: ^m%s^:\npath: ^m%s^:\nevent: ^m%s^:" , watchPath , path_ , event ) ;

	discoveryPathObject = this.undeadWatchers[ watchPath ].__discoveryPathObject ;
	//log.debug( "onFsWatchEvent() disco:\n%I" , discoveryPathObject ) ;

	// The file should not be in the include list
	if ( discoveryPathObject ) {
		if ( event !== 'add' && event !== 'addDir' ) {
			log.verbose( "discovery: excluding path '%s' (not an 'add' event)" , path_ ) ;
			return ;
		}

		log.verbose( "discovery: path: %s -- %I" , path_ , discoveryPathObject ) ;

		discoveryList = Object.keys( discoveryPathObject ) ;

		found = false ;

		for ( i = 0 , iMax = discoveryList.length ; i < iMax ; i ++ ) {
			log.verbose( "discovery: tried '%s'" , discoveryList[ i ] ) ;

			if ( minimatch( path_ , discoveryList[ i ] ) ) {
				log.verbose( "discovery: including path '%s' by '%s'" , path_ , discoveryList[ i ] ) ;
				found = true ;
				break ;
			}
		}

		if ( ! found ) {
			log.verbose( "discovery: excluding path '%s' (nothing found)" , path_ ) ;
			return ;
		}
	}


	var clear = () => {
		if ( this.undeadRespawnTimer ) {
			clearTimeout( this.undeadRespawnTimer ) ;
			this.undeadRespawnTimer = null ;
		}
	} ;

	this.undeadRespawnMap[ path_ ] = true ;

	log.debug( "About to raise undead: '%s' ('%s' event on '%s')" , path_ , event , watchPath ) ;

	clear() ;
	await this.waitFor( 'idle' ) ;
	clear() ;
	this.undeadRespawnTimer = setTimeout( async () => {
		clear() ;
		await this.waitFor( 'idle' ) ;
		clear() ;
		var undeadList = Object.keys( this.undeadRespawnMap ) ;
		this.undeadRespawnMap = {} ;

		if ( undeadList.length ) {
			// Some respawn may have been canceled
			this.emit( 'undeadRaised' , undeadList ) ;
		}
		else {
			log.debug( "undeadRaised canceled: all respawn were canceled" ) ;
		}
	} , this.undeadRespawnTime ) ;
} ;



CasterBook.onUndeadRaised = async function( undeadList ) {
	var date = new Date() ;

	Ngev.groupEmit(
		this.clients ,
		'coreMessage' ,
		"^MIt's %s, the hour the DEAD are walking!!!^:\n" ,
		( '0' + date.getHours() ).slice( -2 ) + ':' + ( '0' + date.getMinutes() ).slice( -2 ) + ':' + ( '0' + date.getSeconds() ).slice( -2 )
	) ;

	undeadList.forEach( filePath => {
		let cwd = path.normalize( this.cwd + '/' ) ;
		if ( filePath.startsWith( cwd ) ) { filePath = filePath.slice( cwd.length ) ; }

		Ngev.groupEmit(
			this.clients ,
			'coreMessage' ,
			"^/^y%s^ ^Yis raised again!^:\n" ,
			filePath
		) ;
	} ) ;

	try {
		await this.reset() ;
	}
	catch ( error ) {
		log.error( "Undead raised, reset error: %E" , error ) ;
	}

	try {
		await this.undeadBoundFn() ;
	}
	catch ( error ) {
		log.debug( "Undead raised: %E" , error ) ;
	}

	/*
	Ngev.groupEmit(
		this.clients ,
		'coreMessage' ,
		"^MUndead raised at %s!!!^:\n" ,
		( '0' + date.getHours() ).slice( -2 ) + ':' + ( '0' + date.getMinutes() ).slice( -2 ) + ':' + ( '0' + date.getSeconds() ).slice( -2 )
	) ;
	*/
} ;

