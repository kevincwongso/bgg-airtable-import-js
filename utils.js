const axios = require('axios')
const he = require('he')

// fetchBGG constants
const BGG_XML_API_URL = 'https://www.boardgamegeek.com/xmlapi2'
const XML_RETRY_DELAY_SECONDS = 1
const XML_MAX_RETRY = 10

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

function sanitizeDescription(description) {
	return he.decode(description)
		.replace(/([\s]*—)?[\s]*[Dd]escription from the (designer|publisher)[\s]*(\:[\s]*)?/g, '\n\n')
		.replace(/\n[ ]{3,}/g, '\n* ')
		.replace(/([0-9])\./g, '$1\\.')
		.replace(/\n{2,}/g, '\n\n')
		.trim()
}

module.exports = {
	fetchBGG,
	sanitizeDescription,
}
