/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

var restify = require('restify');
var builder = require('botbuilder');
var request = require('request').defaults({ encoding: null });

var luis = require('./luis.json');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    stateEndpoint: process.env.BotStateEndpoint,
    openIdMetadata: process.env.BotOpenIdMetadata 
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

/*----------------------------------------------------------------------------------------
* Bot Storage: This is a great spot to register the private state storage for your bot. 
* We provide adapters for Azure Table, CosmosDb, SQL Azure, or you can implement your own!
* For samples and documentation, see: https://github.com/Microsoft/BotBuilder-Azure
* ---------------------------------------------------------------------------------------- */

// Create your bot with a function to receive messages from the user
var bot = new builder.UniversalBot(connector, function (session) {
    session.send('Sorry, the OMS autobot didn\'t understand \'%s\'. Type \'order\' if you would like to place an order.', session.message.text);
});

var botLoggerHostName = process.env.BotLogHostName;

// Make sure you add code to validate these fields
var luisAppId = process.env.LuisAppId;
var luisAPIKey = process.env.LuisAPIKey;
var luisAPIHostName = process.env.LuisAPIHostName || 'westus.api.cognitive.microsoft.com';

const LuisModelUrl = 'https://' + luisAPIHostName + '/luis/v2.0/apps/' + luisAppId + '?subscription-key=' + luisAPIKey + '&staging=true&verbose=true&timezoneOffset=0&q=';

console.log(LuisModelUrl)

var recognizer = new builder.LuisRecognizer(LuisModelUrl);
bot.recognizer(recognizer);

bot.dialog('Order', [
    function (session, args, next) {
        var order = session.dialogData.order = {}

        if (args && args.isReprompt && args.dialogData && args.dialogData.order){
            // We were sent here to revalidate some user input
            // Reinitialise the order data using the args
            order = session.dialogData.order = args.dialogData.order
        }
        else if (args && args.intent && args.intent.entities){
            // LUIS recognizer triggered dialog
            // Scrape out all intent entities
            var {intent} = args
            console.log(intent.entities)

            var stock = builder.EntityRecognizer.findEntity(intent.entities, 'Stocks')
            if (stock && stock.resolution){
                order.stock = stock.resolution.values[0]
            }

            var quantity = builder.EntityRecognizer.findEntity(intent.entities, 'builtin.number')
            if (quantity && quantity.resolution){
                order.qty = quantity.resolution.value
            }

            var direction = builder.EntityRecognizer.findEntity(intent.entities, 'OrderDirection')
            if (direction && direction.entity){
                order.direction = direction.entity
            }
        }

        if (!order.stock) {
            builder.Prompts.text(session, 'What stock would you like to order?', {
                speak: 'What stock would you like to order?',
                retrySpeak: 'What stock would you like to order? Say cancel to dismiss me',
                inputHint: builder.InputHint.expectingInput
            })
        } else {
            next()
        }

    },
    /*
        --1-- Validate stock
     */
    function (session, results, next) {
        var {dialogData} = session
        var {order} = dialogData

        if (!order.stock) {
            // Example response: { index: 0, entity: 'Apple', score: 0.8 }
            const bestMatch = builder.EntityRecognizer.findBestMatch(getStockListFromLuisConfig(), results.response, 0.7)
            console.log(bestMatch)
            if (bestMatch){
                order.stock = bestMatch.entity
            }
        }

        if (!order.stock) {
            // Unable to validate stock, send back to the start...
            session.replaceDialog('Order', {dialogData: dialogData, isReprompt: true});
        }
        else if (!order.qty){
            builder.Prompts.number(session, 'How many '+order.stock+' would you like to order?')
        } else {
            next()
        }

    },
    /*
        --2-- Validate qty
     */
    function (session, results, next) {
        var {dialogData} = session
        var {order} = dialogData

        if (!order.qty) {
            order.qty=results.response
        }

        if (!order.direction){
            builder.Prompts.choice(session, 'Would you like to buy or sell '+order.stock+'?', ['Buy','Sell'],
                { listStyle: builder.ListStyle.button })
        } else {
            next()
        }

    },
    /*
        --3-- Validate direction
     */
    function (session, results) {
        var {dialogData} = session
        var {order} = dialogData

        if (!order.direction) {
            // check the confirmation response
            console.log(results.response)
            if (results.response.entity){
                order.direction=results.response.entity
            }
            else {
                console.log('Something went wrong, I shouldn\'t end up here')
            }

        }

        builder.Prompts.text(session, 'Placing a ['+order.direction+'] order for ['+order.qty+'] of ['+order.stock+']...');

    }
]).triggerAction({
    matches: 'Order',
    /*TODO:: disable confirmation prompt to avoid 'ibm'/'microsoft' stock confirmation triggering unwanted new dialog confirmation*/
    //confirmPrompt: "This will cancel the creation of order you started. Are you sure?"
}).cancelAction('cancelCreateNote', "Order canceled.", {
    matches: /^(cancel|nevermind)/i,
    confirmPrompt: "Are you sure you want to stop ordering?"
});



/*
* "closedLists": [
    {
      "name": "Stocks",
      "subLists": [
        {
          "canonicalForm": "Apple",
          "list": []
        },
        {
          "canonicalForm": "Optus",
          "list": []
        },
        ...
      ]
    }*/
function getStockListFromLuisConfig() {
    const stockList = luis.closedLists.filter(list=>list.name === 'Stocks')[0]
    return stockList.subLists.map(element=>element.canonicalForm)
}

const logUserConversation = (event) => {
    console.log(event)
    var logUrl=botLoggerHostName+'/conversation/log?conversationId='+event.address.conversation.id
    console.log(logUrl)
    var requestData = {
        url: logUrl,
        json: true
    };
    request.get(requestData, function (error, response, body) {});
};

// Middleware for logging
bot.use({
    receive: function (event, next) {
        logUserConversation(event);
        next();
    },
    send: function (event, next) {
        logUserConversation(event);
        next();
    }
});