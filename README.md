# bgg-airtable-import-js
JS script to import a Boardgamegeek.com user collection to Airtable. Uses `npm`.

Airtable template to use with this script can be found here: https://airtable.com/universe/expVdaJX7EbWrOPer/bgg-inventory

**1. Clone the repository:**
```
git clone https://github.com/kevincwongso/bgg-airtable-import-js.git
cd bgg-airtable-import-js
```

**2. Install node modules:**
```
npm install
```

**3. Add a new `values.json` file in the folder**

It should contain your Airtable API key, base ID, and your BGG username, like this:
```
{
	"AIRTABLE_API_KEY": "aAbBcCdD_______", // Airtable API key, see FAQ
	"AIRTABLE_BASE_ID": "a1b2c3d4_____", // Airtable base ID, see FAQ
	"BGG_USER": "kwongso" // your BGG username
}
```

Make sure you use these exact property names.

**4. Run the script**
```
npm start
```
This script will only import games and expansions marked as "Owned" in your BGG collection.

The script will also only add new boardgames and expansions that aren't already added to the Airtable base.
To refresh the table by deleting all existing entries, and then importing the whole collection from zero again, use:
```
npm reset
```

## FAQs (Frequently Asked Questions)

### How do I get my Airtable API key?
Follow the instructions provided by Airtable, which can be found [here](https://support.airtable.com/hc/en-us/articles/219046777-How-do-I-get-my-API-key-)

### How do I get my Airtable base id?
Login to Airtable, and go to https://airtable.com/api . Click on the base you want to import to (don't forget to copy [this](https://airtable.com/universe/expVdaJX7EbWrOPer/bgg-inventory) template), and it will open a documentation page. 

The documentation page should have the id of the base listed :
```
The ID of this base is a1b2c3d4______.
```
