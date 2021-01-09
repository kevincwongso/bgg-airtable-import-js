const fs = require('fs')
const axios = require('axios')
const xml2js = require('xml2js')
const Airtable = require('airtable')
const _ = require('lodash')

const BGG_XML_API_URL = 'https://www.boardgamegeek.com/xmlapi2'
const XML_RETRY_DELAY_SECONDS = 1
const XML_MAX_RETRY = 10
const AIRTABLE_API_CHUNKS = 10

async function fetchBGG(path, params = {}) {
	let retry = true
	let response = null
	let tries = 0
	while(retry) {
		try {
			response = await axios.get(`${BGG_XML_API_URL}${path}`, { params })
		} catch(err) {
			console.log('--> ERROR - fetchBGG request throws error')
			console.log(err)
			console.log(JSON.stringify(err.response.data,null,2))
			return null
		}

		if (response.status === 202) {
			console.log(`--> ACCEPTED (202) - retrying in ${XML_RETRY_DELAY_SECONDS} seconds`)
			await new Promise(resolve => setTimeout(resolve, XML_RETRY_DELAY_SECONDS*1000)) // sleep
			tries += 1
		} else if (response.status === 200) {
			retry = false
		} else {
			console.log(`--> ERROR - fetchBGG request returns unexpected status (${response.status})`)
			console.log(JSON.stringify(response.data,null,2))
			return null
		}

		if (tries >= XML_MAX_RETRY) {
			console.log(`--> MAX RETRIES - reached max retry limit of ${XML_MAX_RETRY} times`)
			return null
		}
	}
	return response.data
}

async function main() {
	console.log('* reading values.json')
	const {
		AIRTABLE_API_KEY,
		AIRTABLE_BASE_ID,
		BGG_USER
	} = JSON.parse(await fs.promises.readFile('./values.json', { encoding: 'utf8' }))
	console.log('--> OK - values.json successfully parsed')

	console.log(`\n* fetching collection`)
	let boardgamesXML = await fetchBGG('/collection', {
		username: BGG_USER,
		subtype: 'boardgame',
		excludesubtype: 'boardgameexpansion',
		brief: 1,
		own: 1,
	})
	let expansionsXML = await fetchBGG('/collection', {
		username: BGG_USER,
		subtype: 'boardgameexpansion',
		brief: 1,
		own: 1,
	})
	console.log(`--> OK - collection fetch successful`)

	console.log('\n* parsing collection XML')
	const parser = new xml2js.Parser()
	let boardgameIds = await parser.parseStringPromise(boardgamesXML)
	boardgameIds = boardgameIds.items.item.map(i => i.$.objectid)
	let expansionIds = await parser.parseStringPromise(expansionsXML)
	expansionIds = expansionIds.items.item.map(i => i.$.objectid)
	console.log(`--> ${boardgameIds.length} games and ${expansionIds.length} expansions found`)

	Airtable.configure({ apiKey: AIRTABLE_API_KEY })
	const base = Airtable.base(AIRTABLE_BASE_ID)
	const boardgamesTable = base('Boardgames')
	const expansionsTable = base('Expansions')

	console.log('\n* fetching existing games in Airtable')
	let existingBoardgames = await boardgamesTable.select().all()
	let existingBoardgameIds = existingBoardgames.map(r => r.fields.ID)
	let existingExpansions = await expansionsTable.select().all()
	let existingExpansionIds = existingExpansions.map(r => r.fields.ID)
	console.log(`--> ${existingBoardgameIds.length} games and ${existingExpansionIds.length} expansions found`)

	console.log('\n* sorting differences')
	let newBoardgameIds = _.difference(boardgameIds, existingBoardgameIds)
	let newExpansionIds = _.difference(expansionIds, existingExpansionIds)
	let removableBoardgameIds = _.difference(existingBoardgameIds, boardgameIds)
	let removableExpansionIds = _.difference(existingExpansionIds, expansionIds)
	if (process.env.RESET) {
		console.log(`--> RESET mode on, will delete all existing entries and re-import the whole collection`)
		newBoardgameIds = boardgameIds
		newExpansionIds = expansionIds
		removableBoardgameIds = existingBoardgameIds
		removableExpansionIds = existingExpansionIds
	} else {
		console.log(`--> ${newBoardgameIds.length} games and ${newExpansionIds.length} expansions can be ADDED to Airtable`)
		console.log(`--> ${removableBoardgameIds.length} games and ${removableExpansionIds.length} expansions can be REMOVED from Airtable`)
	}

	if (removableBoardgameIds.length > 0) {
		console.log(`\n* removing ${removableBoardgameIds.length} boardgames from Airtable`)
		removableBoardgameIds = removableBoardgameIds.map(i => existingBoardgames.find(bg => bg.fields.ID === i).id)
		for (let chunk of _.chunk(removableBoardgameIds, AIRTABLE_API_CHUNKS)) {
			await boardgamesTable.destroy(chunk)
			console.log(`--> deleted ${chunk.length} entries`)
		}
		console.log(`--> OK - removed all old Airtable boardgame entries`)
	}
	if (removableExpansionIds.length > 0) {
		console.log(`\n* removing ${removableExpansionIds.length} expansions from Airtable`)
		removableExpansionIds = removableExpansionIds.map(i => existingExpansions.find(e => e.fields.ID === i).id)
		for (let chunk of _.chunk(removableExpansionIds, AIRTABLE_API_CHUNKS)) {
			await expansionsTable.destroy(chunk)
			console.log(`--> deleted ${chunk.length} entries`)
		}
		console.log(`--> OK - removed all old Airtable expansion entries`)
	}

	if (newBoardgameIds.length > 0) {
		console.log(`\n* adding ${newBoardgameIds.length} boardgames to Airtable from BGG`)
		console.log(`--> fetching ${newBoardgameIds.length} BGG entries`)
		let boardgameThingsXML = await fetchBGG('/thing', {
			id: newBoardgameIds.join(',')
		})
		console.log(`--> ${newBoardgameIds.length} BGG entries fetched`)
		let integrationLinks = {}
		let boardgameThings = (await parser.parseStringPromise(boardgameThingsXML)).items.item.map(t => {
			let tags = []
			let integrations = []
			for (let link of t.link) {
				if (link.$.type === 'boardgamecategory' || link.$.type === 'boardgamemechanic') {
					tags.push(link.$.value)
				} else if (link.$.type === 'boardgameintegration' && boardgameIds.includes(link.$.id)){
					if (!integrationLinks[t.$.id]) { integrationLinks[t.$.id] = []}
					integrationLinks[t.$.id].push(link.$.id)
				}
			}
			return {
				fields: {
					ID: t.$.id,
					Name: t.name[0].$.value,
					Images: [
						{ url: t.image[0] }
					],
					"Min Players": parseInt(t.minplayers[0].$.value),
					"Max Players": parseInt(t.maxplayers[0].$.value),
					"Min Playing Time": parseInt(t.minplaytime[0].$.value),
					"Max Playing Time": parseInt(t.maxplaytime[0].$.value),
					Description: t.description[0].replace(/[^\x00-\x7F]/g, ""),
					"BGG Tags": tags,
				}
			}
		})
		for (const chunk of _.chunk(boardgameThings, AIRTABLE_API_CHUNKS)) {
			await boardgamesTable.create(chunk, { typecast: true })
			console.log(`--> created ${chunk.length} entries`)
		}
		const integrationRecords = await boardgamesTable.select({
			filterByFormula: `OR(${_.uniq(_.flattenDeep(Object.entries(integrationLinks))).map(ID => `{ID} = '${ID}'`)})`
		}).all()
		for (let chunk of _.chunk(Object.entries(integrationLinks), AIRTABLE_API_CHUNKS)) {
			await boardgamesTable.update(
				chunk.map(
					([game, integratesWith]) => {
						game = integrationRecords.find(r => r.fields.ID === game).id
						integratesWith = integratesWith.map(i => integrationRecords.find(r => r.fields.ID === i).id)
						return {
							id: game,
							fields: {
								Integrations: integratesWith
							}
						}
					}
				)
			)
			console.log(`--> added ${chunk.length} integration links`)
		}
		console.log(`--> OK - created all new Airtable boardgame entries`)
	}

	if (newExpansionIds.length > 0) {
		console.log(`\n* adding ${newExpansionIds.length} expansions to Airtable from BGG`)
		console.log(`--> fetching ${newExpansionIds.length} BGG entries`)
		let expansionThingsXML = await fetchBGG('/thing', {
			id: newExpansionIds.join(',')
		})
		console.log(`--> ${newExpansionIds.length} BGG entries fetched`)
		let expansionLinks = {}
		let expansionThings = (await parser.parseStringPromise(expansionThingsXML)).items.item.map(t => {
			let tags = []
			let expansions = []
			for (let link of t.link) {
				if (link.$.type === 'boardgamecategory' || link.$.type === 'boardgamemechanic') {
					tags.push(link.$.value)
				} else if (link.$.type === 'boardgameexpansion' && boardgameIds.includes(link.$.id)){
					if (!expansionLinks[t.$.id]) { expansionLinks[t.$.id] = []}
					expansionLinks[t.$.id].push(link.$.id)
				}
			}
			return {
				fields: {
					ID: t.$.id,
					Name: t.name[0].$.value,
					Images: [
						{ url: t.image[0] }
					],
					"Min Players": parseInt(t.minplayers[0].$.value),
					"Max Players": parseInt(t.maxplayers[0].$.value),
					"Min Playing Time": parseInt(t.minplaytime[0].$.value),
					"Max Playing Time": parseInt(t.maxplaytime[0].$.value),
					Description: t.description[0].replace(/[^\x00-\x7F]/g, ""),
					"BGG Tags": tags,
				}
			}
		})
		for (const chunk of _.chunk(expansionThings, AIRTABLE_API_CHUNKS)) {
			await expansionsTable.create(chunk, { typecast: true })
			console.log(`--> created ${chunk.length} entries`)
		}
		const expansionBGRecords = await boardgamesTable.select({
			filterByFormula: `OR(${_.uniq(_.flattenDeep(Object.values(expansionLinks))).map(ID => `{ID} = '${ID}'`)})`
		}).all()
		const expansionExpRecords = await expansionsTable.select({
			filterByFormula: `OR(${_.uniq(_.flattenDeep(Object.keys(expansionLinks))).map(ID => `{ID} = '${ID}'`)})`
		}).all()
		for (let chunk of _.chunk(Object.entries(expansionLinks), AIRTABLE_API_CHUNKS)) {
			await expansionsTable.update(
				chunk.map(
					([expansion, expands]) => {
						expansion = expansionExpRecords.find(r => r.fields.ID === expansion).id
						expands = expands.map(i => expansionBGRecords.find(r => r.fields.ID === i).id)
						return {
							id: expansion,
							fields: {
								Boardgames: expands
							}
						}
					}
				)
			)
			console.log(`--> added ${chunk.length} expansion links`)
		}
		console.log(`--> OK - created all new Airtable expansion entries`)
	}

	console.log('\n* END - main script has finished running, exiting!')
}
main().catch(err => {
	console.log('-> ERROR thrown by main(), exiting')
	console.log(err)
})
