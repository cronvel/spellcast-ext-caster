/*
	Spellcast

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



const extension = require( '../extension.js' ) ;

const Lazyness = extension.host.exports.Lazyness ;
const tags = extension.host.exports.tags ;
module.exports = tags ;



function deftag( object , tag , path ) {
	Lazyness.requireProperty( require , object , tag , './' + path + 'Tag.js' ) ;
}

// A bit hacky, probably better without using host.require
function deftagFromCore( object , tag , path , fromCore = false ) {
	Lazyness.requireProperty( extension.host.require , object , tag , './tags/' + path + 'Tag.js' ) ;
}



tags.addCaster = object => {
	deftag( object , 'formula' , 'caster/Formula' ) ;
	deftag( object , 'spell' , 'caster/Spell' ) ;
	deftag( object , 'summoning' , 'caster/Summoning' ) ;
	deftag( object , 'reverse-summoning' , 'caster/ReverseSummoning' ) ;
	deftag( object , 'cast' , 'caster/Cast' ) ;
	deftag( object , 'summon' , 'caster/Summon' ) ;
	deftag( object , 'scroll' , 'caster/Scroll' ) ;
	deftag( object , 'wand' , 'caster/Wand' ) ;
	deftag( object , 'zap' , 'caster/Zap' ) ;
	deftag( object , 'epilogue' , 'caster/Epilogue' ) ;
	deftag( object , 'prologue' , 'caster/Prologue' ) ;
	deftag( object , 'glob' , 'caster/Glob' ) ;
	deftagFromCore( object , 'chant' , 'io/Message' ) ;
} ;



tags.caster = {} ;
tags.addCommon( tags.caster ) ;
tags.addCaster( tags.caster ) ;
tags.addStory( tags.caster ) ;
tags.addInterpreter( tags.caster ) ;

