require('dotenv').config()

const { ScanCommand, PutCommand, DeleteCommand, GetCommand, UpdateCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb")
const documentClient = require("./dynamodbClient");
const { table } = require('console');
async function addEntry(entry, tableName=process.env.DYNAMO_NAME) {

    // Add a check to see if the user is appropiately being handled here
    const response = await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: entry
    }))
    return true;
}
async function removeEntry(keyName, key, tableName=process.env.DYNAMO_NAME) {
    const response = await documentClient.send(new DeleteCommand({
        TableName: tableName,
        Key: {
            [keyName]: key
        }
    }))
    return true;
}



async function updateEntry(keyName, keyValue, updateAttributes, tableName=process.env.DYNAMO_NAME) {
    // Guard against empty updateAttributes
    return new Promise(async (resolve) => {

        if (Object.keys(updateAttributes).length === 0) {
            throw new Error("updateAttributes cannot be empty");
        }
    
        let updateExpression = "SET ";
        const expressionAttributeValues = {};
        const expressionAttributeNames = {};
    
        Object.entries(updateAttributes).forEach(([attr, value], index) => {
            if (index > 0) updateExpression += ", ";
            updateExpression += `#${attr} = :${attr}`;
            expressionAttributeValues[`:${attr}`] = value;
            expressionAttributeNames[`#${attr}`] = attr;
        });
    
        const response = await documentClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { [keyName]: keyValue },
            UpdateExpression: updateExpression, // <-- Fixed uppercase 'U'
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "UPDATED_NEW"
        }));

        resolve(response.Attributes || true);



    })
    

    // return response.Attributes || true;
}


async function locateEntry(keyName, value, tableName=process.env.DYNAMO_NAME) {
    return new Promise(async(resolve) => {


        if (keyName.toLowerCase() === process.env.PARTITION_KEY.toLowerCase()) {
            const response = await documentClient.send(new GetCommand({
                TableName: tableName,
                Key: {
                    [keyName]: value, 
                }
            }))
            // console.log(response);

            resolve(response.Item || "")
        } else {

            const response = await documentClient.send(new QueryCommand({
                TableName: tableName,
                IndexName: keyName+"-index",
                KeyConditionExpression: `${keyName} = :value`,
                ExpressionAttributeValues: {
                    ":value": value.trim()
                }
            }));

            resolve(response.Items || "")
        }
        
        
        
      
        
    })
    // this could be different keys


    
}


module.exports = {locateEntry, removeEntry, addEntry,updateEntry}



