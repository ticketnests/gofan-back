require('dotenv').config()

const { ScanCommand, PutCommand, DeleteCommand, GetCommand, UpdateCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb")
const documentClient = require("./dynamodbClient");
const { table } = require('console');
const { TableAlreadyExistsException } = require('@aws-sdk/client-dynamodb');
async function addEntry(entry, tableName=process.env.DYNAMO_NAME) {

    // Add a check to see if the user is appropiately being handled here
    const response = await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: entry
    }))
    return true;
}


/**
 * Search DynamoDB by sort key only (scan with filter).
 * WARNING: Scans are expensive and slow on large tables.
 * @param {string} sortKeyName - The name of the sort key attribute.
 * @param {string} sortKeyValue - The value to search for.
 * @param {string} tableName - DynamoDB table name.
 * @returns {Promise<Array>} - Array of matching items.
 */
async function searchBySortKey(sortKeyName, sortKeyValue, tableName = process.env.DYNAMO_NAME) {
    const params = {
        TableName: tableName,
        FilterExpression: "#sk = :skVal",
        ExpressionAttributeNames: {
            "#sk": sortKeyName
        },
        ExpressionAttributeValues: {
            ":skVal": sortKeyValue
        }
    };

    let items = [];
    let lastEvaluatedKey = undefined;

    do {
        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }
        const response = await documentClient.send(new ScanCommand(params));
        if (response.Items) {
            items = items.concat(response.Items);
        }
        lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
}


async function removeEntry(keyName, key, tableName=process.env.DYNAMO_NAME, sortName="schoolName", sortValue="x") {
    const keys = {
        [keyName]: key,
    }
    if (tableName === process.env.DYNAMO_SECONDARY) {
        keys[sortName] = sortValue;
    }
    const response = await documentClient.send(new DeleteCommand({
        TableName: tableName,
        Key: keys
    }))
    return true;
}



async function updateEntry(keyName, keyValue, updateAttributes, tableName=process.env.DYNAMO_NAME,sortName="schoolName", sortValue="x") {
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
    
        const keys = {
            [keyName]: keyValue

        }

        if (tableName===process.env.DYNAMO_SECONDARY) {
            keys[sortName] = sortValue;
        }
        const response = await documentClient.send(new UpdateCommand({
            TableName: tableName,
            Key: keys,
            UpdateExpression: updateExpression, // <-- Fixed uppercase 'U'
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "UPDATED_NEW"
        }));

        resolve(response.Attributes || true);



    })
    

    // return response.Attributes || true;
}


async function locateEntry(keyName, value, tableName=process.env.DYNAMO_NAME, overridePartition=false, sortName="schoolName", sortKey="x", limitAmount=1000) {
    return new Promise(async(resolve) => {
        if ((keyName.toLowerCase() === process.env.PARTITION_KEY.toLowerCase()) && !overridePartition) {
            const keys = {            
                    [keyName]: value, 
            }
            if (tableName===process.env.DYNAMO_SECONDARY) {
                keys[sortName] = sortKey
            }
            const response = await documentClient.send(new GetCommand({
                TableName: tableName,
                Key: keys
            }))
            // console.log(response);

            resolve(response.Item || null)
        } else {
            // console.log("this is occuring", !overridePartition ? keyName+"-index" : keyName)
            let response;
            if (overridePartition) {
                console.log('we just got here', tableName);
                console.log("keyName: ", keyName);
                console.log("value: ", value.trim());


                


                response = await documentClient.send(new QueryCommand({
                    TableName: tableName,

                    KeyConditionExpression: `#pk = :value`,
                    ExpressionAttributeNames: {
                        "#pk": keyName 
                    },
                    ExpressionAttributeValues: {
                        ":value": value.trim()
                    },
                    Limit: limitAmount,
                    ScanIndexForward: false
                }));
                if (limitAmount!==1000) {
                    resolve({query: response.Items ||null, lastKey: response.LastEvaluatedKey })
                }
                
                resolve({query: response.Items} || null)
                
            } else {

                response = await documentClient.send(new QueryCommand({
                    TableName: tableName,
                    IndexName: !overridePartition ? keyName+"-index" : keyName,
                    KeyConditionExpression: `${keyName} = :value`,
                    ExpressionAttributeValues: {
                        ":value": value.trim()
                    },
                    Limit: limitAmount,
                    ScanIndexForward: false
                }));

                console.log("This is the response raw", response)
                
                if (limitAmount!==1000) {
                    resolve({query: response.Items ||null, lastKey: response.LastEvaluatedKey })
                }
                
                resolve({query: response.Items} || null)
            }
            

           

     
        }
        
        
        
      
        
    })
    // this could be different keys


    
}



// This would only happen for begins with kind of things
async function searchEntry(keyName, keyValue, sortName, sortValue, tableName) {
    return new Promise(async (resolve) => {
      try {
        const response = await documentClient.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: "#pk = :pkVal AND begins_with(#sk, :skVal)",
              ExpressionAttributeNames: {
                "#pk": keyName,       // e.g., "uuid"
                "#sk": sortName,      // e.g., "schoolName"
              },
              ExpressionAttributeValues: {
                ":pkVal": keyValue,   // e.g., "SCHOOLNAMES"
                ":skVal": sortValue,  // e.g., "into"
              },
            })
          );
        console.log(response);

  
        resolve(response.Items || null);
      } catch (err) {
        console.log("err here",err)
        resolve(err);
      }
    });
  }
  



module.exports = {locateEntry, removeEntry, addEntry,updateEntry, searchEntry, searchBySortKey}



