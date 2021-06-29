const xml2js = require('xml2js')
const { fetchBGG, sanitizeDescription } = require('./utils')

function doWithCatchLog(f) {
	f().catch(err => {
		console.log('-> ERROR thrown by inspect script, exiting')
		console.log(err)
	})
}

if (process.env.SCRIPT === 'inspect') {
	doWithCatchLog(async () => {
		const parser = new xml2js.Parser()

		let thingId = process.argv.slice(2)
		if (!thingId) {
			throw new Error("No thingId parameter supplied.")
		}

		let thingsXml = await fetchBGG('/thing', { id: thingId.join(',') })
		let things = await parser.parseStringPromise(thingsXml)

		console.log(JSON.stringify(things,null,2))
	})
} else if (process.env.SCRIPT === 'inspect-sanitized') {
	doWithCatchLog(async () => {
		const parser = new xml2js.Parser()

		let thingId = process.argv.slice(2)
		if (!thingId) {
			throw new Error("No thingId parameter supplied.")
		}

		let thingsXml = await fetchBGG('/thing', { id: thingId.join(',') })
		let things = await parser.parseStringPromise(thingsXml)

		console.log(
			JSON.stringify(
				things.items.item.map(t => `${t.name[0].$.value}: ${sanitizeDescription(t.description[0])}`),
				null,
				2
			)
		)
	})
} else if (process.env.SCRIPT === 'check-expansions') {
	doWithCatchLog(async () => {
		const parser = new xml2js.Parser()

		const bggUser = process.argv[2]
		if (!bggUser) {
			throw new Error("No bggUser parameter supplied.")
		}

		let ownedBoardgamesXML = await fetchBGG('/collection', {
			username: bggUser,
			subtype: 'boardgame',
			brief: 1,
			excludesubtype: 'boardgameexpansion',
			own: 1,
		})
		let ownedBoardgameIds = await parser.parseStringPromise(ownedBoardgamesXML)
		ownedBoardgameIds = ownedBoardgameIds.items.item.map(i => i.$.objectid)

		let ownedExpansionsXML = await fetchBGG('/collection', {
			username: bggUser,
			subtype: 'boardgameexpansion',
			brief: 1,
			own: 1,
		})
		let ownedExpansionIds = await parser.parseStringPromise(ownedExpansionsXML)
		ownedExpansionIds = ownedExpansionIds.items.item.map(i => i.$.objectid)
		let preorderedExpansionsXML = await fetchBGG('/collection', {
			username: bggUser,
			subtype: 'boardgameexpansion',
			brief: 1,
			preordered: 1,
		})
		let preorderedExpansionIds = await parser.parseStringPromise(preorderedExpansionsXML)
		preorderedExpansionIds = preorderedExpansionIds.items.item.map(i => i.$.objectid)
		ownedExpansionIds = ownedExpansionIds.concat(preorderedExpansionIds)

		// only the '/thing' API has expansion links
		let unownedExpansionIds = []
		let unownedExpansionLinks = []
		let ownedBoardgameThingsXML = await fetchBGG('/thing', {
			id: ownedBoardgameIds.join(',')
		})
		let ownedBoardgameThings = await parser.parseStringPromise(ownedBoardgameThingsXML)
		ownedBoardgameThings.items.item.map(t => {
			for (let link of t.link) {
				if (
					link.$.type === 'boardgameexpansion' &&
					!ownedExpansionIds.includes(link.$.id) &&
					!unownedExpansionIds.includes(link.$.id)
				) {
					unownedExpansionIds.push(link.$.id)
					unownedExpansionLinks.push({ ...link, source: `${t.$.id} ${t.name[0].$.value}` })
				}
			}
		})
		console.log(unownedExpansionLinks.map(l => `${l.$.id} (${l.source}) - ${l.$.value}`).join('\n'))
	})
}
