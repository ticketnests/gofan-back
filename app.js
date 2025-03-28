require('dotenv').config()
// npm i express https cors fs body-parser express-session uuid memorystore @aws-sdk/lib-dynamodb @aws-sdk/client-dynamodb md5 cryptr

const {authenticateUser, isEmail, isPassword, isString, isNumber, craftRequest, setCookie, sendEmail, generateCode} = require('./functions.js');
const express = require("express");
const https = require("https");
const cors = require("cors")
const {v4: uuid, v4} = require("uuid");
const fs = require('fs');

const md5 = require('md5');
const bodyParser = require("body-parser")
const app = express();
const region = "us-east-1"
const session = require("express-session");
const { locateEntry, addEntry, updateEntry } = require('./databaseFunctions.js');
const MemoryStore = require('memorystore')(session)

const bcrypt = require("bcrypt");

const Cryptr = require('cryptr');
const { report } = require('process');

const saltRounds = 10;

const cmod = new Cryptr(process.env.ENCRYPTION_KEY);

// Things to do

const SCHEMA = ['name','email','password']

// Basic web server configurations
let options;
if (process.env.NODE_ENV === "DEV") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    // development certificate
    options = {
        key: fs.readFileSync('C:\\Users\\marac\\code\\hackathon-quhacks\\key.pem'),
        cert: fs.readFileSync('C:\\Users\\marac\\code\\hackathon-quhacks\\cert.pem'),
        // Remove this line once done with production
        rejectUnauthorized: false
    };    
    // Local host
    app.use(cors({
        origin: "http://localhost:5173",
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true
    }));
    
} else {

    // STEP 1: This will be where the certificates are stored.

    options = {
        key: fs.readFileSync('C:\\Program Files\\Git\\usr\\bin\\key.pem'),
        cert: fs.readFileSync('C:\\Program Files\\Git\\usr\\bin\\certificate.pem'),
        // Remove this line once done with production
        rejectUnauthorized: false
    };    

    app.use(cors({
        origin: process.env.PROD_URL,
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true
    }));
    // prod credentials


}


// Setting up cookies
app.use(session({
    secret: process.env.COOKIE_SECRET,
    cookie: {
        path: "/",
        maxAge: 2628000000,
        httpOnly: true,     
        sameSite: "none",
        secure: true,
    },
    resave: false,
    saveUninitialized: true,
    store: new MemoryStore({
        checkPeriod: 86400000 
    }), 
}));

// Setting up body parser
app.use(bodyParser.json({limit: "10mb"}))





const server = https.createServer(options, app)








app.get("/", (req,res) => {
    res.send("new year new me")
})





app.post('/register', async (req,res) => {
    // These are where the checks are. 
    console.log("asdf")


    // You need to add a variable name for every single thing you are trying to do.
    try {
        const {name, email, password} = req.body;



        if (password && email && name) {


            if (isEmail(email) && isPassword(password) && isString(name)) {

                // then we should check if the user exists or not
                
                await locateEntry("emailHash", md5(email.toLowerCase())).then((users) => {
                    console.log("this is users", users)
                    if (users.length>0) {
                        // This would only occur when this user already exists
                        
                        res.status(307).send(craftRequest(307))


                    } else {
                        const user = users[0];

                        if (user) {
                            res.status(307).send(craftRequest(307));
                        } else {
                            let newUser = {};
                            const allKeys = Object.keys(req.body);
                            allKeys.forEach((key) => {

                                if (SCHEMA.includes(key)) {
                                    if (key.toLowerCase() !== "password") {
                                        newUser = {[key]: cmod.encrypt(req.body[key].trim().toLowerCase())}
                                    }


                                }
                             
                                
                            })

                            const uuid = v4();
                            // We should encrypt the password here
                            // We should maybe add some type safety here
                            bcrypt.hash(password, saltRounds, (err,hash) => {

                                if (err) {
                                    reportError(err);
                                    console.log(err)
                                    res.status(404).send(craftRequest(404));

                                } else {
                                    addEntry({ 
                                
                                
                                        uuid: uuid,
                                        name: name,
                                        emailHash: md5(email.trim()),
                                        email: cmod.encrypt(email.trim()),
                                        password: hash,
                                        ...newUser,
        
                                    })
                                    
                            setCookie(req,uuid);
                            res.status(200).send(craftRequest(200,uuid));
                                }

                            })



                          

                            


                            // addEntry(newUser);
                        }





                    }
                    
    
    
                })
    
    
    
            } else {
                res.status(400).send(craftRequest(400));
            }

        } else {
            res.status(400).send(await craftRequest(400));
        }
    } catch(e) {
        console.log(e);
    }
})

app.post("/login", (req,res) => {

    try {

        const {email, password} = req.body;


        if (isEmail(email) && isPassword(password)) {
            locateEntry("emailHash", md5(email)).then((users) => {
                if (users.length>0) {
                    console.log(users[0])
                    locateEntry("uuid", users[0].uuid).then((user) => {
                        // console.log(thing);
                        if (user != null) {
                            


                            bcrypt.compare(password, user.password, (err,result) => {
                                if (err) {
                                    console.log(err);
                                    res.status(400).send(craftRequest(400));
                                } else {

                                    
                                    if (result) {
                                        setCookie(req, user.uuid);
                                        res.status(200).send(craftRequest(200));
                                    } else {
                                        res.status(400).send(craftRequest(400));
                                    }


                                }
                            })

                        } else {
                            res.status(400).send(craftRequest(400));
                        }
                    })
                } else {
                    res.status(400).send(craftRequest(400));
                }
            })
        } else {
            res.status(403).send(craftRequest(403));
        }



    } catch(e) {

        reportError(e);
        res.status(400).send(craftRequest(400));
    }



}) 

app.get("/getUser", (req,res) => {

    authenticateUser(req).then((user) => {
        if (user === "No user found") {
            res.status(403).send(craftRequest(403));
        } else {
            
            locateEntry("uuid", user).then((user) => {
                // console.error(users);

                if (user) {
                    res.status(200).send(craftRequest(200,user))
                } else {
                    res.status(400).send(craftRequest(400));
                }
                // if (users.length>0) {
                //     const user = users[0];

                //     console.log(user);
                //     res.status(200).send(craftRequest(200,user));

                // } else {
                //     console.log("log",users)
                //     res.status(200).send(craftRequest(200,user))
                // }
            })



        }
    })


})

app.post("/changeSettings", (req,res) => {

    try {

        // const {...x} = req.body;
        // console.log("req",req.body);
        authenticateUser(req).then((id) => {

            if (id === "No user found") {
    
                res.status(403).send(craftRequest(403))
            } else {
                
                locateEntry("uuid", id).then((user) => {
                    if (user !== "") {
                        

                        const changedUser = {}
                        console.log(Object.keys(user))

                        Object.keys(user).map((key) => {
                            console.log("ajdsf", key)
                            if ((key !== "email") && (key !== "emailHash") && (key !== "password")) {
                                if (Object.keys(req.body).includes(key.toLowerCase())) {
                                    changedUser[key] = req.body[key];
                                }
                            }
                        })  


                        console.log("changed user", changedUser)
                        updateEntry("uuid", user.uuid, changedUser).then((a) => {
                            console.log("a", a);
                            res.status(200).send(craftRequest(200));
                        })
                        return;
                        // do something here
                    } else {
                        res.status(400).send(craftRequest(400));
                    }
    
                    
                })
    
    
    
    
    
            }
    
    
    
        })


    } catch(e) {


        console.log(e)
        reportError(e);
        res.status(400).send(craftRequest(400));
        return;

    }
   


})



// This won't work
app.post("/sendCode", (req,res) => {
    try {

        const {email} = req.body;
        

        if (isEmail(email)) {
            locateEntry("emailHash", md5(email.trim())).then((users) => {
                // console.log("this is the",user)
                if (users.length !== 0) {
                    // console.log(user);
                    const user = users[0]
                    const code = generateCode(6)

                    const text = `Hello,

You have asked to reset your password. If this wasn't you, ignore this email.

Your code is: ${code}`

                    // bookmark
                    console.log(user)
                    updateEntry("uuid", user.uuid, {passwordCode: code}).then((response) => {
                        if (response) {
                            sendEmail(email.trim(), `Reset Password - ${process.env.COMPANY_NAME}`,text).then((alert) => {
                                if (alert) {
                                    res.status(200).send(craftRequest(200));
                                } else {
                                    res.status(400).send(craftRequest(400));
                                }
                            
                            })
                        } else {
                            res.status(400).send(craftRequest(400));
                        }
                    })
                    


                } else {
                    res.status(400).send(craftRequest(400));
                }
            })


        } else {
            res.status(400).send(craftRequest(400));
        }




    } catch(e) {
        console.log(e);
        reportError(e);
        res.status(400).send(craftRequest(400));
    }
})




app.post("/changePassword", (req,res) => {
    try {
        const {code, password, email} = req.body;

        console.log(isPassword(password))
        console.log(isNumber(code))

        if (isPassword(password) && isNumber(code)) {


            const emailHash = md5(email);

            

            locateEntry("emailHash", emailHash).then((users) => {
                if (users.length !== 0) {
                    const user = users[0];

                    locateEntry("uuid", user.uuid).then((user) => {
                        if (user !== "") {

                            if (String(user.passwordCode) === String(code)) {


                                if (isPassword(password)) {
                                    
                                    
                                    bcrypt.hash(password, saltRounds, function(err, hash) {
                                    // Store hash in your password DB.

                                        if (err) {
                                            reportError(err);
                                            res.status(400).send(craftRequest(400))
                                            
                                        } else {
                                            
                                            updateEntry("uuid",user.uuid,{password: hash}).then((x) => {
                                                res.status(200).send(craftRequest(200));
                                            })
                                        }
                                    });
                                    


                                } else {
                                    res.status(400).send(craftRequest(400, {status: "invalid password"}))
                                }



                            


                            } else {
                                res.status(400).craftRequest(400, {status: "invalid code"})
                            }

                        } else {

                            res.status(400).send(craftRequest(400));


                        }

                    })




                } else {



                    res.status(403).send(craftRequest(403));
                }
            })

            





        } else {
            console.log(code);
            console.log(password);
            console.log(email);
            res.status(400).send(craftRequest(400));
        }

    } catch(e) {
        console.log(e);
        reportError(e);
        res.status(400).send(craftRequest(400));
    }
})







app.post("/schoolLogin", (req,res) => {
    try {




        


    } catch(e) {



    }
})




app.post("/createSchool", (req,res) => {
    // name: "Walter Johnson High School",
    // address: '6400 Rock Spring Dr, Bethesda, MD 20814',


    // One admin account per school

    // email
    try {
        const {email, name, schoolAddress, password} = req.body;

        if (isEmail(email) && isString(name, 30) && schoolAddress.length<1000) {
            
            locateEntry("emailHash", md5(email),process.env.DYNAMO_SECONDARY).then((users) => {
                
                if (users.length === 0) {
                   


                    bcrypt.hash(password, saltRounds, function(err, hash) {


                        if (err) {
                            console.log(err);
                            res.status(400).send(craftRequest(400));
                        } else {
                            if (hash !== null) {
                            
                                const uuid = v4()
                                const newSchool = {
                                    uuid: uuid,
                                    password: hash,
                                    emailHash: md5(email),
                                    email: cmod.encrypt(email),
                                    schoolAddress: cmod.encrypt(schoolAddress),
                                    name: cmod.encrypt(name),
                                }
        
        
                                
        
                                addEntry(newSchool, process.env.DYNAMO_SECONDARY).then((x) => {
                                    res.status(200).send(craftRequest(200));
        
                                })
        
        
                            } else {
                                res.status(400).send(craftRequest(400));
                            }
                        }
        
                        // Store hash in your password DB.
                    });
                 


                } else {
                    res.status(400).send(craftRequest(400));
                }

            })
           



        } else {
            res.status(400).send(craftRequest(400));
        }





    } catch(e) {
        console.log(e)
        reportError(e);
        res.status(400).send(craftRequest(400))
    }

})














server.listen(process.env.PORT, () => {
    console.log("Listening on port:", process.env.PORT)
})






