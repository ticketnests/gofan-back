require('dotenv').config()
const {DynamoDBClient} = require("@aws-sdk/client-dynamodb")
const {DynamoDBDocumentClient} = require("@aws-sdk/lib-dynamodb")


const dbClient = new DynamoDBClient({
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.ACCESSKEY,
        secretAccessKey: process.env.SECRETACCESSKEY
    }

})


const marshallOptions = {
    convertEmptyValues: false,
    removeUndefinedValues: false,
    convertClassInstanceToMap: false,
}

const unmarshallOptions = {
    wrapNumbers: false,
}

const translateConfig = { marshallOptions, unmarshallOptions}



const documentClient = DynamoDBDocumentClient.from(dbClient, translateConfig)


module.exports = documentClient;