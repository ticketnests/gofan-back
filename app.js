require("dotenv").config();
const { Parser } = require("json2csv");

// npm i express https cors fs body-parser express-session uuid memorystore @aws-sdk/lib-dynamodb @aws-sdk/client-dynamodb md5 cryptr
const stripe = require("stripe")(
  process.env.NODE_ENV === "DEV"
    ? process.env.STRIPE_TEST
    : process.env.STRIPE_SECRET
);
const {
  authenticateUser,
  isEmail,
  isPassword,
  isString,
  isNumber,
  craftRequest,
  setCookie,
  sendEmail,
  generateCode,
  formatString,
  reportError,
  calculateTransfer,
  removeCookie
} = require("./functions.js");
const express = require("express");
const http = require("http");
const cors = require("cors");
const {v4: uuid, v4} = require("uuid");
const fs = require('fs');

const md5 = require("md5");
const bodyParser = require("body-parser");
const app = express();
// const region = "us-east-1"
// const session = require("express-session");
const cookieParser = require("cookie-parser")
// const jwt = require('jsonwebtoken');

const {
  locateEntry,
  addEntry,
  updateEntry,
  searchEntry,
  removeEntry,
  searchBySortKey
} = require("./databaseFunctions.js");
// const MemoryStore = require("memorystore")(session);
const { CronJob } = require('cron');
const bcrypt = require("bcrypt");

const Cryptr = require("cryptr");
// const { report } = require('process');
// const { start } = require('repl');

const QRCode = require("qrcode");
const { report } = require("process");
// const { report } = require('process');
// const { createTracing } = require('trace_events');

// const e = require('express');

const saltRounds = 10;

const cmod = new Cryptr(process.env.ENCRYPTION_KEY);

// Things to do

const SCHEMA = ["name", "email", "password"];

// Basic web server configurations
if (process.env.NODE_ENV === "DEV") {
  app.use(
    cors({
      origin: ["http://localhost:3000", "http://localhost:5173"],
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      credentials: true,
    })
  );

} else {
  app.use(
        cors({
          origin: [process.env.PROD_URL],
          methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
          credentials: true,
        })
      );
}

// Setting up cookies

app.use(cookieParser(process.env.HTTP_COOKIE_SECRET))


// app.use(function (req,res,next) {
  
//   const cookie = req.cookies['jwt'];

//   if (cookie ===undefined) {


//   }


// })

// app.use(
//   session({
//     secret: process.env.COOKIE_SECRET,
//     cookie: {
//       path: "/",
//       maxAge: 2628000000,
//       httpOnly: true,
//       sameSite: "lax",
//       // secure: true,
//     },
//     resave: false,
//     saveUninitialized: true,
//     store: new MemoryStore({
//       checkPeriod: 86400000,
//     }),
//   })
// );








// I haven't checked this code yet.
const doMidnightTasks = async () => {
  // I need to invalidate every single entry

  console.log("Doing midnight tasks");
  const schools = await searchBySortKey("schoolName", "x", process.env.DYNAMO_SECONDARY);

  // Process each school sequentially
  for (const school of schools) {
    // Checking every single event;
    const originalEvents = school.events || [];

    for (let i = 0; i < originalEvents.length; i++) {
      const currentEvent = originalEvents[i];

      if (currentEvent.isActive) {

        if (Number(cmod.decrypt(currentEvent.endDate)) < Date.now()) {
          originalEvents[i].isActive = false;
          console.log("it toggled the if statement")
        } else {
          console.log(Date.now());
          console.log(Number(cmod.decrypt(currentEvent.startDate)));
          console.log(cmod.decrypt(currentEvent.name) + " didn't trigger it")
          console.log("didnt trigger it")
        }
      }
    }

    // Only update if changes were made
    if (JSON.stringify(originalEvents) !== JSON.stringify(school.events)) {
      await updateEntry("uuid", school.uuid, { events: originalEvents }, process.env.DYNAMO_SECONDARY);
    }
  }

  console.log("This was completed successfully");
};


// doMidnightTasks();


const job = CronJob.from({
	cronTime: '0 0 0 * * *',
	onTick: doMidnightTasks,
	start: true,
})




app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];

  console.log("THIS WEBHOOK WAS CALLED");
  let event;

  const endpointSecret = process.env.STRIPE_WEBHOOK;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("all headers", req.headers)
    // const getFullEvent = async() => {
    //   const x = await stripe.events.retrieve(event.id)
    //   console.log("full event", x);
    // }
    // getFullEvent();
    console.log("Connected Account Id:",  req.headers['stripe-account'])
    switch (event.type) {


      // We need to add a case of what happens when the credit card declines. 


      case "payment_intent.succeeded":
        const paymentIntentSucceeded = event.data.object;
        console.log("Checkout Completed: ", paymentIntentSucceeded);
        console.log("Checkout Completed: ", paymentIntentSucceeded["metadata"]);
        console.log("metadata", paymentIntentSucceeded.metaData);
        if (paymentIntentSucceeded.metadata.uuid) {
          locateEntry("uuid", paymentIntentSucceeded.metadata.uuid).then(
            (user) => {
              if (user) {
                // This will need to be connected
                console.log(
                  "this is the full request: ",
                  paymentIntentSucceeded
                );
                // Tickets will be stored in tickets db.
                let totalAmountGenerated = 0;
                const metaData = paymentIntentSucceeded.metadata;
                console.log("this is all the metaData: ", metaData);
                JSON.parse(metaData.allBought).forEach((item) => {
                  totalAmountGenerated += item.price;
                  const newTicket = {
                    ticketId: v4(),
                    showTicket: true,
                    type: item.name,
                    price: item.price,
                    userId: user.uuid,
                    isActive: true,
                    eventId: metaData.eventId,
                    startDate: cmod.encrypt(metaData.startDate),
                    endDate: cmod.encrypt(metaData.endDate),
                    name: cmod.encrypt(metaData.name),
                    school: cmod.encrypt(metaData.school),
                    dateBought: Date.now(),
                  };

                  addEntry(newTicket, process.env.DYNAMO_THIRD).then(() => {
                    console.log("Added a ticket just now");
                    return;
                  });
                });
                locateEntry(
                  "uuid",
                  metaData.schoolId,
                  process.env.DYNAMO_SECONDARY
                ).then((school) => {
                  if (school != null) {
                    // const prevEvents = school.events;

                    const updatedEvents = school.events?.map((event) => {
                      if (event.id === metaData.eventId) {
                        return {
                          ...event,
                          ticketsSold:
                            Number(event.ticketsSold) +
                            JSON.parse(metaData.allBought).length,
                          totalRevenue:
                            Number(event.totalRevenue) +
                            Number(totalAmountGenerated),
                          CPT:
                            (Number(event.totalRevenue) +
                              Number(totalAmountGenerated)) /
                            (event.ticketsSold + 1),
                        };
                      } else {
                        return event;
                      }
                    });
                    console.log("updated events", updatedEvents);
                    console.log("heres the metaData", metaData);
                    updateEntry(
                      "uuid",
                      metaData.schoolId,
                      { events: updatedEvents, amountAvailable: Number(school.amountAvailable + calculateTransfer(totalAmountGenerated, JSON.parse(metaData.allBought).length)) },
                      process.env.DYNAMO_SECONDARY
                    ).then(async() => {
                      try {
                        const transfer = await stripe.transfers.create({
                          amount: calculateTransfer(totalAmountGenerated, JSON.parse(metaData.allBought).length)*100,
                          currency: "usd",
                          destination: school.stripeId
        
                        })
                        console.log("all is well", updatedEvents);
                        res.status(200).send(craftRequest(200));
                      } catch(e) {
                        console.log(e);
                        reportError(e);
                        res.status(400).send(craftRequest(400, e))
                      
                      
                      }
                      



                      
                    });
                  }
                });

                // prevTickets.push({
                //     isActive: true,
                //     // bookmark77
                //     eventId: metaData.eventId,
                //     startDate: metaData.startDate,
                //     endDate: metaData.endDate,
                //     schoolId: metaData.schoolId,
                //     name: metaData.name,

                // })

                // console.log("Heres the thing",prevTickets)
              } else {
                reportError("A user paid but didn't have any uuid?");
                res.status(400).send(craftRequest(400));
              }
            }
          );
        } else {
          reportError(
            "A user didn't have any uuid but did end up paying " +
              paymentIntentSucceeded.metaData.uuid
          );
          console.log("This user didn't have any metadata");
          res.status(400).send(craftRequest(400));
        }

        // Then define and call a function to handle the event checkout.session.completed
        break;
      // ... handle other event types


      case "account.updated":
        console.log("Account updated: ", event);
        
        if (typeof event?.account === "string") {

          console.log("Updated account ID:", event.account);
          const id = event.account;
          // Check that this works here

          locateEntry("stripeId", id, process.env.DYNAMO_SECONDARY).then(({query}) => {
            const list = query;
            if (list.length>0) {
              const school = list[0];
              console.log(event.data.object["payouts_enabled"])
              if (event.data.object["payouts_enabled"]) {
                
                updateEntry("uuid", school.uuid, { hasVerified: true }, process.env.DYNAMO_SECONDARY).then(() => {
    
                  res.status(200).send(craftRequest(200));
                })
              } else {
                updateEntry("uuid", school.uuid, { hasVerified: false }, process.env.DYNAMO_SECONDARY).then(() => {
    
                  res.status(200).send(craftRequest(200));
                })
              }


            } else {


              res.status(400).send(craftRequest(400, "how tf did this happen"));
            }

          })
       
         



        } else {
          res.status(400).send(craftRequest(400));
        }
        break;


      case "payout.paid": 

      // This code hasn't been tested at all
        if (event.account) {
          const id = event.account;
          const paidOutObject = event.data.object;
          console.log(event);
          locateEntry("stripeId", id, process.env.DYNAMO_SECONDARY).then(({ query }) => {
            const users = query;
            if (users && users.length > 0) {
              const user = users[0];
              updateEntry("uuid", user.uuid, {
                lastWithdraw: Date.now(),
                amountAvailable: (Number(user.amountAvailable) - Number(paidOutObject.amount) / 100).toFixed(2)
              });
            } else {
              res.status(400).send(craftRequest(400));
            }
          });
        } else {
          res.status(400).send(craftRequest(400, event));
        }
        
        break;

        


        // res.status(200).send(craftRequest(200));


      default:
        console.log(`Unhandled event type ${event.type}`);
        res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.get("/getTickets", (req, res) => {
  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
        if (id) {
          // 1 just for testing

          locateEntry("userId", id, process.env.DYNAMO_THIRD, false, 1).then(
            ({ query, lastKey }) => {
              const tickets = query;
              if (tickets) {
                const decryptedTickets = [];
                console.log("we got tickets here", tickets);
                tickets.forEach((ticket) => {
                  decryptedTickets.push({
                    ticketId: ticket.ticketId,
                    endDate: cmod.decrypt(ticket.endDate),
                    eventId: ticket.eventId,
                    isActive: ticket.isActive,
                    name: cmod.decrypt(ticket.name),
                    school: cmod.decrypt(ticket.school),
                    startDate: cmod.decrypt(ticket.startDate),
                    type: ticket.type,
                  });
                });
                console.log("this is decrypted tickets", decryptedTickets);
                // console.log9
                res
                  .status(200)
                  .send(craftRequest(200, { tickets: decryptedTickets }));
              } else {
                res.status(200).send(craftRequest(200, { tickets: [] }));
              }
            }
          );
        } else {
          res.status(403).send(craftRequest(403));
        }
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

// Setting up body parser
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

const server = http.createServer(app);

app.get("/", (req, res) => {
  res.send("new year new me");
});

app.post("/register", async (req, res) => {
  // These are where the checks are.
  console.log("asdf");

  // You need to add a variable name for every single thing you are trying to do.
  try {
    const { name, email, password } = req.body;

    if (password && email && name) {
      if (isEmail(email) && isPassword(password) && isString(name)) {
        // then we should check if the user exists or not

        await locateEntry("emailHash", md5(email.toLowerCase())).then(
          (users) => {
            console.log("this is users", users);
            if (users.length > 0) {
              // This would only occur when this user already exists

              res.status(307).send(craftRequest(307));
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
                      newUser = {
                        [key]: cmod.encrypt(req.body[key].trim().toLowerCase()),
                      };
                    }
                  }
                });

                const uuid = v4();
                // We should encrypt the password here
                // We should maybe add some type safety here
                bcrypt.hash(password, saltRounds, (err, hash) => {
                  if (err) {
                    reportError(err);
                    console.log(err);
                    res.status(404).send(craftRequest(404));
                  } else {
                    addEntry({
                      uuid: uuid,
                      name: name,
                      emailHash: md5(email.trim()),
                      email: cmod.encrypt(email.trim()),
                      password: hash,
                      ...newUser,
                    });

                    setCookie(req, res,uuid);
                    res.status(200).send(craftRequest(200, uuid));
                  }
                });

                // addEntry(newUser);
              }
            }
          }
        );
      } else {
        res.status(400).send(craftRequest(400));
      }
    } else {
      res.status(400).send(await craftRequest(400));
    }
  } catch (e) {
    console.log(e);
  }
});

app.post("/login", (req, res) => {
  try {
    const { email, password, isAdmin } = req.body;

    if (isEmail(email) && isPassword(password)) {
      locateEntry(
        "emailHash",
        md5(email),
        isAdmin ? process.env.DYNAMO_SECONDARY : process.env.DYNAMO_NAME
      ).then(({ query }) => {
        const users = query;
        if (users.length > 0) {
          console.log(users[0]);
          locateEntry(
            "uuid",
            users[0].uuid,
            isAdmin ? process.env.DYNAMO_SECONDARY : process.env.DYNAMO_NAME
          ).then((user) => {
            // console.log(thing);
            if (user != null) {
              console.log("we get here");
              bcrypt.compare(password, user.password, (err, result) => {
                if (err) {
                  console.log(err);
                  res.status(400).send(craftRequest(400));
                } else {
                  console.log("do passwords match", result);

                  if (result) {
                    setCookie(req,res, user.uuid);
                    if (isAdmin) {
                      res
                        .status(200)
                        .send(craftRequest(200, { url: "/admindashboard", id: users[0].uuid, name: cmod.decrypt(users[0].name), hasVerified: (isAdmin ? users[0].hasVerified : undefined)  }));
                    } else {
                      console.log(users[0]);
                      locateEntry("uuid", users[0].uuid).then((user) => {
                        
                        res
                        .status(200)
                        .send(craftRequest(200, { url: "/dashboard", id: user.uuid, name: cmod.decrypt(user.name) }));


                      })


               
                    }
                  } else {
                    res.status(400).send(craftRequest(400));
                  }
                }
              });
            } else {
              res.status(400).send(craftRequest(400));
            }
          });
        } else {
          if (isAdmin) {
            locateEntry(
              "emailHash",
              md5(email.toLowerCase()),
              process.env.DYNAMO_FOURTH
            ).then(({ query }) => {
              const thing = query;

              if (thing.length > 0) {
                bcrypt.compare(password, query[0].password, (err, result) => {
                  if (err) {
                    reportError(err);
                    res.status(400).send(craftRequest(400));
                  } else {
                    if (result) {
                      setCookie(req,res, query[0].uuid);
                      res
                        .status(200)
                        .send(craftRequest(200, { url: "/scanUser", id: query[0].uuid, name: cmod.decrypt(query[0].name) }));
                        // 
                    } else {
                      res.status(400).send(craftRequest(400));
                    }
                  }
                });
              } else {
                res.status(400).send(craftRequest(400));
              }
            });
          } else {
            res.status(400).send(craftRequest(400));
          }
        }
      });
    } else {
      res.status(403).send(craftRequest(403));
    }
  } catch (e) {
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.get("/getUser", (req, res) => {
  authenticateUser(req).then((id) => {
    if (id === "No user found") {
      res.status(403).send(craftRequest(403));
    } else {
      locateEntry("uuid", id).then((user) => {
        if (user !== null) {
          console.log("currUser", user);
          const openUser = {
            isAdmin: false,
            uuid: user.uuid,
            email: cmod.decrypt(user.email),
            name: cmod.decrypt(user.name),
          };

          res.status(200).send(craftRequest(200, openUser));
        } else {
          // This would be for admin Accounts
          console.log("heres the thing");
          locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then((user) => {
            if (user !== null) {
              const eventList = [];
              if (user.events) {
                user.events.map((event) => {
                  // console.log("start date value",cmod.decrypt(event.startDate))
                  const startDate = Number(cmod.decrypt(event.startDate));
                  const date = new Date(startDate).toLocaleDateString("en-US", {
                    year: "2-digit",
                    month: "numeric",
                    day: "numeric",
                  });
                  eventList.push({
                    id: event.id,
                    date: date,
                    type: cmod.decrypt(event.type),
                    startDate: startDate,
                    endDate: cmod.decrypt(event.endDate),
                    name: cmod.decrypt(event.name),
                  });
                });
              }

              const currentUser = {
                isAdmin: true,
                hasVerified: user.hasVerified,
                events: eventList,
                uuid: user.uuid,
                email: cmod.decrypt(user.email),
                name: cmod.decrypt(user.name),
                schoolAddress: cmod.decrypt(user.schoolAddress),
              };
              res.status(200).send(craftRequest(200, currentUser));
            } else {
              locateEntry("uuid", id, process.env.DYNAMO_FOURTH).then(
                (user) => {
                  if (user !== null) {
                    locateEntry(
                      "uuid",
                      user.schoolId,
                      process.env.DYNAMO_SECONDARY
                    ).then((school) => {
                      if (school !== null) {
                        const eventList = [];
                        if (school.events) {
                          school.events.map((event) => {
                            // console.log("start date value",cmod.decrypt(event.startDate))
                            const startDate = Number(
                              cmod.decrypt(event.startDate)
                            );
                            const date = new Date(startDate).toLocaleDateString(
                              "en-US",
                              {
                                year: "2-digit",
                                month: "numeric",
                                day: "numeric",
                              }
                            );
                            eventList.push({
                              id: event.id,
                              date: date,
                              type: cmod.decrypt(event.type),
                              startDate: startDate,
                              endDate: cmod.decrypt(event.endDate),
                              name: cmod.decrypt(event.name),
                            });
                          });
                        }

                        const x = {
                          isSecurity: true,
                          isAdmin: false,
                          name: cmod.decrypt(user.name),
                          email: cmod.decrypt(user.email),
                          schoolId: user.schoolId,
                          events: eventList,
                        };

                        res.status(200).send(craftRequest(200, x));
                      } else {
                        res.status(400).send(craftRequest(400));
                      }
                    });
                  } else {
                    res.status(400).send(craftRequest(400));
                  }
                }
              );
            }
          });
        }
        // if (users.length>0) {
        //     const user = users[0];

        //     console.log(user);
        //     res.status(200).send(craftRequest(200,user));

        // } else {
        //     console.log("log",users)
        //     res.status(200).send(craftRequest(200,user))
        // }
      });
    }
  });
});

app.post("/changeSettings", (req, res) => {
  try {
    // const {...x} = req.body;
    // console.log("req",req.body);
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
        locateEntry("uuid", id).then((user) => {
          if (user !== "") {
            const changedUser = {};
            console.log(Object.keys(user));

            Object.keys(user).map((key) => {
              console.log("ajdsf", key);
              if (
                key !== "email" &&
                key !== "emailHash" &&
                key !== "password"
              ) {
                if (Object.keys(req.body).includes(key.toLowerCase())) {
                  changedUser[key] = req.body[key];
                }
              }
            });

            console.log("changed user", changedUser);
            updateEntry("uuid", user.uuid, changedUser).then((a) => {
              console.log("a", a);
              res.status(200).send(craftRequest(200));
            });
            return;
            // do something here
          } else {
            res.status(400).send(craftRequest(400));
          }
        });
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
    return;
  }
});

// This won't work
app.post("/sendCode", (req, res) => {
  try {
    const { email } = req.body;

    if (isEmail(email)) {
      locateEntry("emailHash", md5(email.trim())).then((users) => {
        // console.log("this is the",user)
        if (users.length !== 0) {
          // console.log(user);
          const user = users[0];
          const code = generateCode(6);

          const text = `Hello,

You have asked to reset your password. If this wasn't you, ignore this email.

Your code is: ${code}`;

          // bookmark
          console.log(user);
          updateEntry("uuid", user.uuid, { passwordCode: code }).then(
            (response) => {
              if (response) {
                sendEmail(
                  email.trim(),
                  `Reset Password - ${process.env.COMPANY_NAME}`,
                  text
                ).then((alert) => {
                  if (alert) {
                    res.status(200).send(craftRequest(200));
                  } else {
                    res.status(400).send(craftRequest(400));
                  }
                });
              } else {
                res.status(400).send(craftRequest(400));
              }
            }
          );
        } else {
          res.status(400).send(craftRequest(400));
        }
      });
    } else {
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/changePassword", (req, res) => {
  try {
    const { code, password, email } = req.body;

    console.log(isPassword(password));
    console.log(isNumber(code));

    if (isPassword(password) && isNumber(code)) {
      const emailHash = md5(email);

      locateEntry("emailHash", emailHash).then((users) => {
        if (users.length !== 0) {
          const user = users[0];

          locateEntry("uuid", user.uuid).then((user) => {
            if (user !== "") {
              if (String(user.passwordCode) === String(code)) {
                if (isPassword(password)) {
                  bcrypt.hash(password, saltRounds, function (err, hash) {
                    // Store hash in your password DB.

                    if (err) {
                      reportError(err);
                      res.status(400).send(craftRequest(400));
                    } else {
                      updateEntry("uuid", user.uuid, { password: hash }).then(
                        (x) => {
                          res.status(200).send(craftRequest(200));
                        }
                      );
                    }
                  });
                } else {
                  res
                    .status(400)
                    .send(craftRequest(400, { status: "invalid password" }));
                }
              } else {
                res.status(400).send(craftRequest(400, { status: "invalid code" }));
              }
            } else {
              res.status(400).send(craftRequest(400));
            }
          });
        } else {
          res.status(403).send(craftRequest(403));
        }
      });
    } else {
      console.log(code);
      console.log(password);
      console.log(email);
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/createSchool", (req, res) => {
  // name: "Walter Johnson High School",
  // address: '6400 Rock Spring Dr, Bethesda, MD 20814',

  // One admin account per school

  // email
  try {
    const { email, name, schoolParent, schoolAddress, password, categoryId, isSchoolAccount} = req.body;
    console.log(isEmail(email))
    console.log( isString(name, 30) )
    console.log(typeof isSchoolAccount === "boolean" )
    console.log(schoolAddress.length < 1000)
    console.log(isString(schoolParent, 100))
    console.log(isPassword(password))
    console.log(isString(categoryId, 100))

    if (isEmail(email) && isString(name, 30, true) && typeof isSchoolAccount === "boolean" && schoolAddress.length < 1000 && isString(schoolParent, 100) && isPassword(password) && isString(categoryId, 100)) {
      locateEntry("emailHash", md5(email), process.env.DYNAMO_SECONDARY).then(
        ({ query }) => {
          const users = query;
          console.log("users", users);
          if (users.length === 0) {



            console.log("This happened")


            locateEntry("uuid", isSchoolAccount ? "SCHOOLNAMES" : "PERSONALNAMES", process.env.DYNAMO_SECONDARY, false, "schoolName", isSchoolAccount ? schoolParent.toLowerCase().trim() : name.toLowerCase().trim()).then((school) => {
              
              console.log("school", school);
              // &&isSchoolAccount
              if (school !== null&&isSchoolAccount) {



                  
                      if (school.categoryId === categoryId) {
                        bcrypt.hash(password, saltRounds, async function (err, hash) {
                            if (err) {
                              console.log(err);
                              res.status(400).send(craftRequest(400));
                            } else {
                              if (hash !== null) {
                                const uuid = v4();

                                const account = await stripe.accounts.create({
                                  country: "US",
                                  email: email.trim(),
                                  controller: {
                                    fees: {
                                      payer: "application"
                                    }, 
                                    losses: {
                                      payments: 'application'
                                    }, 
                                    stripe_dashboard: {
                                      type: "express"
                                    }
                                  },

                                })

                                await stripe.accounts.update(account.id, {

                                  tos_acceptance: {
                                    service_agreement: "full",

                                  }
                                })


                                console.log(account);




                                const newSchool = {
                                  stripeId: account.id,
                                  hasVerified: false,
                                  uuid: uuid,
                                  schoolName: "x",
                                  password: hash,
                                  emailHash: md5(email),
                                  email: cmod.encrypt(email),
                                  schoolAddress: cmod.encrypt(schoolAddress),
                                  schoolParent: cmod.encrypt(schoolParent.toLowerCase().trim()),
                                  name: cmod.encrypt(name),
                                  amountAvailable: 0,
                                  // ticketsUsed: 0,
                                  lastWithdraw: null,
                                };
              
                                addEntry(newSchool, process.env.DYNAMO_SECONDARY).then(
                                  (x) => {
                                    

                                    const prevSchools = school.allOrganizations || [];

                                    prevSchools.push(uuid);
                                    updateEntry("uuid", "SCHOOLNAMES", { allOrganizations: prevSchools}, process.env.DYNAMO_SECONDARY, "schoolName", schoolParent.toLowerCase().trim()).then(() => {
                                        setCookie(req,res, uuid);
                                        res.status(200).send(craftRequest(200));
            
                                    })
              
                                    
                                    
              
              
                                  //   addEntry(
                                  //     {
                                  //       uuid: "SCHOOLNAMES",
                                  //       schoolName: name.toLowerCase(),
                                  //       id: uuid,
                                  //     },
                                  //     process.env.DYNAMO_SECONDARY
                                  //   ).then(() => {
                                  //     setCookie(req, uuid);
                                  //     res.status(200).send(craftRequest(200));
                                  //   });
                                  }
                                );
                              } else {
                                res.status(400).send(craftRequest(400));
                              }
                            }
              
                            // Store hash in your password DB.
                          });



                       


                    } else {
                        res.status(400).send(craftRequest(400, { status: "Invalid categoryId" }));
                    }


                } else if (school===null&&!isSchoolAccount) {
                  bcrypt.hash(password, saltRounds, async function (err, hash) {
                    if (err) {
                      console.log(err);
                      res.status(400).send(craftRequest(400));
                    } else {
                      if (hash !== null) {
                        const uuid = v4();

                        const account = await stripe.accounts.create({
                          country: "US",
                          email: email.trim(),
                          capabilities: {
                            card_payments: {
                              requested: true,
                            },
                            transfers: {
                              requested: true,
                            }
                          },
                          controller: {
                            fees: {
                              payer: "application"
                            },
                            losses: {
                              payments: 'application'
                            },
                            stripe_dashboard: {
                              type: "express"
                            },
                          },

                        })

                        await stripe.accounts.update(account.id, {

                          tos_acceptance: {
                            service_agreement: "full",

                          }
                        })


                        console.log(account);




                        const newSchool = {
                          stripeId: account.id,
                          hasVerified: false,
                          uuid: uuid,
                          schoolName: "x",
                          password: hash,
                          emailHash: md5(email),
                          email: cmod.encrypt(email),
                          schoolAddress: cmod.encrypt("N/A"),
                          schoolParent: cmod.encrypt("N/A"),
                          name: cmod.encrypt(name),
                          amountAvailable: 0,
                          // ticketsUsed: 0,
                          lastWithdraw: null,
                        };
      
                        addEntry(newSchool, process.env.DYNAMO_SECONDARY).then(
                          (x) => {
                            

                    

                            addEntry({
                              uuid: "PERSONALNAMES",
                              schoolName: name.trim().toLowerCase(), 
                              categoryId: uuid,
                            }, process.env.DYNAMO_SECONDARY).then(() => {
                              setCookie(req,res, uuid);
                              res.status(200).send(craftRequest(200))
                            })
                          }
                        );
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
            console.log("this is the user", users[0]);
            res.status(400).send(craftRequest(400));
          }
        }
      );
    } else {
    
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});


app.get("/createConnectLink", (req,res) => {
  try {
    authenticateUser(req).then((id) => {
      locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(async(user) => {
        if (user!==null) {
          const accountLink = await stripe.accountLinks.create({
            account: user.stripeId,
            refresh_url: (process.env.NODE_ENV==="DEV" ? "http://localhost:5173" : process.env.PROD_URL) + "/settings",
            return_url: (process.env.NODE_ENV==="DEV" ? "http://localhost:5173" : process.env.PROD_URL)  + "/dashboard",
            type: "account_onboarding",


          })
          console.log(accountLink)

          res.status(200).send(craftRequest(200, { url: accountLink.url }));
          





        } else {
          console.log("the id failed and it was", id);
          res.status(400).send(craftRequest(400));  
        }


      })


    })




  } catch(e) {
    

    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  
  }


})


app.get("/getOrganization", (req,res ) => {
    try {
        const { uuid } = req.query;


        if (isString(uuid, 100) && uuid != undefined) {
            console.log("this is the uuid", uuid);
            locateEntry("categoryId", uuid, process.env.DYNAMO_SECONDARY).then(async({query}) => {
                
                if (query.length > 0) {
                    const organization = query[0];


                    const allSchools = organization.allOrganizations;
                    
                    console.log("this is the organization", organization);
                    const data = {
                        address: "123 Elmo Street",
                        name: formatString(organization.schoolName),
                        allClubs: [],
                    }


                    for (let i=0; i<allSchools.length; i++) {
                        const currentId = allSchools[i];
                        
                        await locateEntry('uuid', currentId, process.env.DYNAMO_SECONDARY).then((school) => {
                            if (school !== null) {
                                
                                if (data.address === "123 Elmo Street") {
                                    data.address = cmod.decrypt(school.schoolAddress);
                                } 

                                const prevClubs = data.allClubs;

                                prevClubs.push({
                                    id: school.uuid,
                                    name: formatString(cmod.decrypt(school.name)),
                                })




                            } 


                        })

                    








                    }



                    if (data.address !== "123 Elmo Street") {
                      res.status(200).send(craftRequest(200, data));
                    } else {
                      res.status(400).send(craftRequest(400));
                    }
                    

                    





                     
                } else {
                    res.status(400).send(craftRequest(400));

                }


            })

        }





    } catch(e) {
        console.log(e);
        reportError(e);
        res.status(400).send(craftRequest(400));
    }


})




app.post("/getSchool", (req, res) => {
  try {
    // This UUID represents the id of a school, not of a user
    const { uuid } = req.body;

    if (isString(uuid, 100) && uuid != undefined) {
      locateEntry("uuid", uuid, process.env.DYNAMO_SECONDARY).then((school) => {
        console.log("school", school);
        if (school !== null && school != undefined) {
          console.log(school);
          const schoolDetails = {
            id: school.uuid,
            name: cmod.decrypt(school.name),
            address: cmod.decrypt(school.schoolAddress),
          };

          const schoolList = [];

          if (school.events !== undefined) {
            school.events.map((event) => {
              if (event.isActive) {
                const startDate = Number(cmod.decrypt(event.startDate));
                const date = new Date(startDate).toLocaleDateString("en-US", {
                  year: "2-digit",
                  month: "numeric",
                  day: "numeric",
                });
                schoolList.push({
                  id: event.id,
                  date: date,
                  type: cmod.decrypt(event.type),
                  startDate: startDate,
                  endDate: cmod.decrypt(event.endDate),
                  name: cmod.decrypt(event.name),
                });
              }
              // console.log("start date value",cmod.decrypt(event.startDate))
            });
          }

          console.log({ ...schoolDetails, events: schoolList });

          res
            .status(200)
            .send(craftRequest(200, { ...schoolDetails, events: schoolList }));
        } else {
          // console.log()
          res.status(404).send(craftRequest(404));
        }
      });
    } else {
      console.log("sf");
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/createEvent", (req, res) => {
  //     options: [{
  //         name: "Adult Pass",
  //         price: 10.99,
  //         amountOfTickets: 0,
  // // Specify ticket prices and options
  //     }, {
  //         name: "Child Pass",
  //         price: 4.99,
  //         amountOfTickets: 0,
  //     }]
  // {
  //     date: "3/9/25",
  //     type: "Ticket",
  //     startDate: Date.now() +1000000,
  //     endDate: Date.now()+10000000000,
  //     name: "Into the Woods",
  //     people: 4,
  // }

  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found" || id === null) {
        res.status(403).send(craftRequest(403));
      } else {
        const {
      
          type,
          startDate,
          endDate,
          name,
          options,
          description,
          isActive,
        } = req.body;

        console.log("isNumber(startDate):", isNumber(startDate));
        console.log("isNumber(endDate):", isNumber(endDate));
        console.log("isString(name):", isString(name));
        console.log("isString(type, 100):", isString(type, 100));
        // console.log("isEmail(email):", isEmail(email));
        console.log("options.length !== 0:", options.length !== 0);

        if (
          description &&
          description.length > 0 &&
          (isActive === true || isActive === false) &&
          description.length < 1000 &&
          isNumber(startDate) &&
          isNumber(endDate) &&
          isString(name) &&
          isString(type, 100) &&
          options.length !== 0
        ) {
          locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(
            async (user) => {
              if (user != null&&user.hasVerified) {
                // Lets check if an option  is valid
                // {
                //         name: "Adult Pass",
                //         price: 10.99,
                //         amountOfTickets: 0,
                // // Specify ticket prices and options
                //     }, {
                //         name: "Child Pass",
                //         price: 4.99,
                //         amountOfTickets: 0,
                //     }

                const x = (option, y) => {
                  return Object.keys(option).includes(y);
                };
                const funct = async () => {
                  const encryptedOptions = await Promise.all(
                    options.map(async (option) => {
                      if (x(option, "name") && x(option, "price")) {
                        if (option.name.length > 0 && !isNaN(option.price)) {
                          // Passed all tests
                          const product = await stripe.products.create({
                            name: option.name,
                            active: true,
                            default_price_data: {
                              currency: "usd",
                              unit_amount: option.price * 100,
                            },
                          });

                          console.log("option", option);
                          console.log(product);

                          return {
                            name: cmod.encrypt(option.name.toLowerCase()),
                            price: cmod.encrypt(option.price),
                            priceId: product.default_price,
                          };
                        } else {
                          console.log("Invalid price or name length");
                          throw new Error("Invalid price or name length");
                        }
                      } else {
                        console.log("Invalid option structure");
                        throw new Error("Invalid option structure");
                      }
                    })
                  );

                  return encryptedOptions;
                };

                funct().then((encryptedOptions) => {
                  const id = v4();

                  const newEvent = {
                    id: id,
                    type: cmod.encrypt(type),
                    startDate: cmod.encrypt(startDate),
                    endDate: cmod.encrypt(endDate),
                    name: cmod.encrypt(name),
                    description: cmod.encrypt(description),
                    options: encryptedOptions,
                    isActive: isActive,
                    ticketsSold: 0,
                    CPT: 0,
                    totalRevenue: 0,
                  };

                  console.log("this is the new event", newEvent);

                  const prevEvents =
                    user.events != undefined ? user.events.slice() : [];
                  prevEvents.push(newEvent);
                  console.log(prevEvents);

                  // Need to create stripe stuff

                  updateEntry(
                    "uuid",
                    user.uuid,
                    { events: prevEvents },
                    process.env.DYNAMO_SECONDARY
                  ).then(() => {
                    res.status(200).send(craftRequest(200));
                  });
                });
              } else {
                res.status(400).send(craftRequest(400));
              }
            }
          );
        } else {
          res.status(400).send(craftRequest(400));
        }
      }
    });
  } catch (e) {
    console.log(e);

    res.status(400).send(craftRequest(400));
  }
});





app.post("/create-checkout-session", (req, res) => {
  try {
    authenticateUser(req).then(async (id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
        const { items, eventId, startDate, endDate, name, school, schoolId } =
          req.body;


        locateEntry("uuid", id).then(async(user) => {
            if (user!==null) {
                if (Array.isArray(items)) {
                    let totalAmt = 0;
                    for (let i = 0; i < items.length; i++) {
                      totalAmt += Number(items[i].amountOfTickets) || 0;
                    }
          
                    if (totalAmt > process.env.MAX_TICKETS) {
                      res.status(400).send(craftRequest(400));
                      return;
                    }
          
                    if (
                      items != undefined &&
                      schoolId !== undefined &&
                      schoolId !== null &&
                      schoolId.length < 1000 &&
                      items != null &&
                      items.length > 0 &&
                      eventId != undefined &&
                      eventId != null &&
                      eventId.length > 0 &&
                      isNumber(startDate) &&
                      isNumber(endDate) &&
                      isString(name, 100) &&
                      isString(school, 100)
                    ) {
                      // {
                      //     // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
                      //     price: '{{PRICE_ID}}',
                      //     quantity: 1,
                      //   },
          
                      console.log("this is the items: ", items);
                      const lineItems = items.map((item) => {
                        if (item.amountOfTickets > 0) {
                          return {
                            quantity:
                              item.amountOfTickets === "" ? 0 : item.amountOfTickets,
                            price: item.priceId,
                          };
                        }
                      });
                      const formattedTickets = [];
                      items.forEach((item) => {
                        // this is the items:  [
                        //     {
                        //       name: 'Adult Ticket',
                        //       price: '10.00',
                        //       amountOfTickets: '3',
                        //       priceId: 'price_1RHu84QGW3QLsR8r1m8TZdE3'
                        //     }
                        for (let i = 0; i < Number(item.amountOfTickets); i++) {
                          formattedTickets.push({
                            name: item.name,
                            price: Number(item.price),
                          });
                        }
                      });
          
                      console.log(lineItems);
                      // uuid: user.uuid,
                      // isActive: true,
                      // eventId: metaData.eventId,
                      // startDate: cmod.encrypt(metaData.startDate),
                      // endDate: cmod.encrypt(metaData.endDate),
                      // name: cmod.encrypt(metaData.name),
                      // school: cmod.encrypt(metaData.school),
                      const session = await stripe.checkout.sessions.create({
                        line_items: lineItems,
                        mode: "payment",
                        payment_intent_data: {
                          metadata: {
                            uuid: id,
                            eventId: eventId,
                            startDate: startDate,
                            endDate: endDate,
                            name: name,
                            school: school,
                            schoolId: schoolId,
                            allBought: JSON.stringify(formattedTickets),
                          },
                        },
                        success_url:
                          process.env.NODE_ENV === "DEV"
                            ? "http://localhost:5173/dashboard"
                            : "https://ticketnest.us/dashboard",
                        cancel_url:
                          process.env.NODE_ENV === "DEV"
                            ? "http://localhost:5173/dashboard"
                            : "https://ticketnest.us/dashboard",
                      });
                      console.log("Session: ", session);
                      console.log("Session: ", session.url);
                      res.status(200).send(craftRequest(200, { url: session.url }));
                    } else {
                      res.status(400).send(craftRequest(400));
                    }
                  } else {
                    res.status(400).send(craftRequest(400));
                  }

            } else {
                res.status(400).send(craftRequest(400));
            }
        })

        
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/getGame", (req, res) => {
  try {
    const { schoolId, gameId } = req.body;
    if (isString(gameId, 100) && isString(schoolId, 100)) {
      locateEntry("uuid", schoolId, process.env.DYNAMO_SECONDARY).then(
        (school) => {
          if (school != null) {
            let game;

            for (let i = 0; i < school.events.length || 0; i++) {
              console.log(school.events[i].id === gameId);
              if ((school.events[i].id === gameId) && (school.events[i].isActive)) {
                game = school.events[i];
                break;
              }
            }

            if (game != undefined && game != null) {
              const ticket = {
                schoolId: school.uuid,
                school: formatString(cmod.decrypt(school.name)),
                address: formatString(cmod.decrypt(school.schoolAddress)),
                event: {
                  eventId: game.id,
                  description: formatString(cmod.decrypt(game.description)),
                  type: cmod.decrypt(game.type),
                  startDate: Number(cmod.decrypt(game.startDate)),
                  endDate: Number(cmod.decrypt(game.endDate)),
                  name: formatString(cmod.decrypt(game.name)),
                },
                options: game.options.map((option) => {
                  return {
                    name: formatString(cmod.decrypt(option.name)),
                    price: cmod.decrypt(option.price),
                    amountOfTickets: 0,
                    priceId: option.priceId,
                  };
                }),
              };

              console.log(ticket);
              res.status(200).send(craftRequest(200, ticket));
            } else {
              res.status(400).send(craftRequest(400));
            }

            // Decryption aspect

            //     id: ticketId,
            //     school: 'Walter Johnson High School',
            //     address: "6400 Rock Spring Dr Bethesda, MD, 20814",
            //     event: {
            //         type: "Ticket",
            //         startDate: Date.now() +1000000,
            //         endDate: Date.now()+10000000000,
            //         name: "Into the Woods",
            //         people: 4,
            //     },
            //     options: [{
            //         name: "Adult Pass",
            //         price: 10.99,
            //         amountOfTickets: 0,
            // // Specify ticket prices and options
            //     }, {
            //         name: "Child Pass",
            //         price: 4.99,
            //         amountOfTickets: 0,
            //     }]

            // const decryptedOptions
          } else {
            console.log("asd");
            res.status(400).send(craftRequest(400));
          }
        }
      );
    } else {
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/generateQRCODE", (req, res) => {
  try {
    const { ticketId } = req.body;
    console.log("This is the body", req.body);
    console.log("This is ticketId", ticketId);

    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
        if (id !== null && id !== undefined && isString(ticketId, 100)) {
          QRCode.toDataURL(ticketId)
            .then((url) => {
              console.log(url);

              if (url) {
                res.status(200).send(craftRequest(200, { img: url }));
              } else {
                res.status(400).send(craftRequest(400));
              }
            })
            .catch((e) => {
              console.log(e);
              reportError(e);
              res.status(400).send(craftRequest(400));
            });
        } else {
          res.status(403).send(craftRequest(403));
        }
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/scanUser", (req, res) => {
  try {
    const { uuid, eventId } = req.body;
    function doScanning(adminUser) {
      console.log("adminUser.events: ", adminUser.events);
      let passedTest = false;
      for (let i = 0; i < adminUser.events.length; i++) {
        if (adminUser.events[i].id === eventId) {
          passedTest = true;
          break;
        }
      }

      if (isString(uuid, 100) && passedTest) {
        // bookmark, could cause errors
        locateEntry("ticketId", uuid, process.env.DYNAMO_THIRD, true).then(
          async ({ query }) => {
            const ticket = query;
            if (ticket.length > 0) {
              console.log("heres ticket", ticket);
              if (ticket[0].isActive) {
                locateEntry("uuid", ticket[0].userId).then((user) => {
                  if (user !== null) {
                    const body = {
                      uuid: ticket[0].userId,
                      ticket: {
                        ticketId: ticket[0].ticketId,
                        name: cmod.decrypt(ticket[0].name),
                        isActive: ticket[0].isActive,
                        uuid: ticket[0].userId,
                      },
                      name: cmod.decrypt(user.name),
                    };

                    updateEntry(
                      "ticketId",
                      ticket[0].ticketId,
                      { isActive: false },
                      process.env.DYNAMO_THIRD
                    ).then(() => {
                      res.status(200).send(craftRequest(200, body));
                    });
                  } else {
                    console.log("this was called #4");
                    res.status(400).send(craftRequest(400));
                  }
                });
              } else {
                res.status(403).send(craftRequest(403));
              }
            } else {
              console.log("this was called #3");
              res.status(400).send(craftRequest(400));
            }
          }
        );
      } else {
        console.log("this was called #2");
        res.status(400).send(craftRequest(400));
      }
    }

    if (isString(uuid, 100) && isString(eventId, 100)) {
      authenticateUser(req).then((id) => {
        if (id === "No user found") {
          res.status(403).send(craftRequest(403));
        } else {
          locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(
            (adminUser) => {
              if (adminUser !== null) {
                doScanning(adminUser);

                // We could potentially add some feature here which only allows people to search if they go to the same school or same school county
              } else {
                locateEntry("uuid", id, process.env.DYNAMO_FOURTH).then(
                  (user) => {
                    if (user !== null) {
                      locateEntry(
                        "uuid",
                        user.schoolId,
                        process.env.DYNAMO_SECONDARY
                      ).then((adminUser) => {
                        if (adminUser !== null) {
                          doScanning(adminUser);
                        } else {
                          res.status(400).send(craftRequest(400));
                        }
                      });
                    } else {
                      res.status(400).send(craftRequest(400));
                    }
                  }
                );
              }
            }
          );
        }
      });
    } else {
      console.log("this was called #1");
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);

    reportError(e);

    res.status(400).send(craftRequest(400));
  }
});

app.get("/getDashboardAdmin", (req, res) => {
  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(400).send(craftRequest(400));
      } else {
        locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then((user) => {
          if (user !== null) {
            const userEvents = user.events || [];

            const decryptedEvents = [];
            // id: id,
            // type: cmod.encrypt(type),
            // startDate: cmod.encrypt(startDate),
            // endDate: cmod.encrypt(endDate),
            // name: cmod.encrypt(name),
            // description: cmod.encrypt(description),
            // options: encryptedOptions,
            // isActive: isActive,
            // ticketsSold: 0,
            // CPT: 0,
            userEvents.forEach((event) => {
              decryptedEvents.push({
                id: event.id,
                type: cmod.decrypt(event.type),
                startDate: cmod.decrypt(event.startDate),
                name: cmod.decrypt(event.name),
                isActive: event.isActive,
                ticketsSold: event.ticketsSold,
                CPT: event.CPT,
                description: cmod.decrypt(event.description),
              });
            });

            res.status(200).send(craftRequest(200, decryptedEvents));

            // the thing is occured
          } else {
            console.log("it failed to locate User");
            res.status(403).send(craftRequest(403));
          }
        });
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/getEventStats", (req, res) => {
  try {
    const { eventId } = req.body;
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
        if (eventId !== null && typeof eventId === "string") {
          const allBuyers = {};

          // Double check if that is the index that is meant to be used for that
          locateEntry(
            "eventId",
            eventId,
            process.env.DYNAMO_THIRD,
            undefined
          ).then(async ({ query }) => {
            const tickets = query;
            console.log("allTickets found", tickets);
            if (tickets !== null) {
              // Process each ticket sequentially
              for (const ticket of tickets) {
                if (!allBuyers[ticket.userId]) {
                  // Await the user lookup
                  const user = await locateEntry("uuid", ticket.userId);
                  if (user != null) {
                    allBuyers[ticket.userId] = {
                      amountSpent: ticket.price || 0, // Initialize with ticket price
                      name: cmod.decrypt(user.name),
                      email: cmod.decrypt(user.email),
                    };
                  }
                } else {
                  // Update the existing amount
                  const newPrice = ticket.price || 0;
                  allBuyers[ticket.userId].amountSpent += newPrice;
                }
              }

              console.log("sent final request");
              const processedList = [];
              Object.keys(allBuyers).forEach((id, i) => {
                processedList.push({
                  id: id,
                  amountPaid: allBuyers[id].amountSpent,
                  name: formatString(allBuyers[id].name),
                  email: allBuyers[id].email.toLowerCase(),
                });
              });

              res.status(200).send(craftRequest(200, processedList));
            } else {
              res.status(400).send(craftRequest(400));
            }
          });
        } else {
          res.status(400).send(craftRequest(400));
        }
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

// We need to add a way to add security personnel to be able to scan tickets, instead of it just being the guy that creates the account.
// every single school could have a list of subpeople that have accounts. Scanning tickets might not be the best way to do this
// Another option to completely opt out from qrcodes and instead do the same way that gofan does things.

// Export ID means the stuff that is in

function exportData(exportId) {
  return new Promise(async (resolve) => {
    try {
      if (exportId) {
        locateEntry("eventId", exportId, process.env.DYNAMO_THIRD).then(
          async ({ query }) => {
            const tickets = query;
            console.log("allTickets found", tickets);
            const allBuyers = {};
            if (tickets !== null) {
              // Process each ticket sequentially
              for (const ticket of tickets) {
                if (!allBuyers[ticket.userId]) {
                  // Await the user lookup
                  const user = await locateEntry("uuid", ticket.userId);
                  if (user != null) {
                    allBuyers[ticket.userId] = {
                      amountSpent: ticket.price || 0, // Initialize with ticket price
                      name: cmod.decrypt(user.name),
                      email: cmod.decrypt(user.email),
                    };
                  }
                } else {
                  // Update the existing amount
                  const newPrice = ticket.price || 0;
                  allBuyers[ticket.userId].amountSpent += newPrice;
                }
              }

              console.log("sent final request");
              const processedList = [];
              Object.keys(allBuyers).forEach((id, i) => {
                processedList.push({
                  id: id,
                  amountPaid: allBuyers[id].amountSpent,
                  name: formatString(allBuyers[id].name),
                  email: allBuyers[id].email.toLowerCase(),
                });
              });

              const fields = ["id", "amountPaid", "name", "email"];
              const opts = { fields };
              const parser = new Parser(opts);
              const csv = parser.parse(processedList);
              resolve(csv);
            } else {
              resolve("err");
            }
          }
        );
      } else {
        resolve("err");
      }
    } catch (e) {
      console.log(e);
      reportError(e);
      resolve("err");
    }
  });
  // Export Id would be for every single event that the person has
}

app.post("/exportData", (req, res) => {
  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        console.log("this is the thing");
        res.status(403).send(craftRequest(403));
      } else {
        const { exportId } = req.body;

        if (exportId && exportId.length > 0 && typeof exportId === "string") {
          exportData(exportId).then((x) => {
            console.log(x);
            if (x !== "err") {
              res.header("Content-Type", "text/csv");
              res.attachment("export.csv");
              res.status(200).send(x);
            } else {
              res.status(400).send(craftRequest(400));
            }
          });
        } else {
          res.status(400).send(craftRequest(400));
        }
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

// CHANGE THIS LATER, THIS IS JUST FOR TESTING

// Make it so that people can toggle events as inactive
app.post("/updateEvent", (req, res) => {
  try {
    const { event } = req.body;

    if (event !== null && event !== undefined) {
      console.log("this occured #1");
      authenticateUser(req).then((id) => {
        if (id === "No user found") {
          res.status(403).send(craftRequest(403));
        } else {
          locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(
            (school) => {
              if (school !== null) {
                const events = school.events || [];
                for (let i = 0; i < events.length; i++) {
                  if (events[i].id === event.id) {
                    events[i].name = cmod.encrypt(event.name);
                    events[i].description = cmod.encrypt(event.description);
                    events[i].isActive = event.isActive;
                    break;
                  }
                }

                // for (const curEvent in events) {
                //     if (curEvent.id === id) {
                //         const updatedEvent = {
                //             CPT: curEvent.CPT,
                //             type: curEvent.type,
                //             totalRevenue: curEvent.totalRevenue || 0,
                //             ticketsSold: curEvent.ticketsSold || 0,
                //             startDate: curEvent.startDate,
                //             description: cmod.encrypt(event.description),
                //             endDate: curEvent.endDate,
                //             isActive: event.isActive,
                //             name: cmod.encrypt(event.name),
                //         }
                //         newEvents.push(updatedEvent);
                //     } else {
                //         newEvents.push(curEvent)
                //     }
                // }
                console.log("this is the new events:", events);
                updateEntry(
                  "uuid",
                  id,
                  { events: events },
                  process.env.DYNAMO_SECONDARY
                ).then(() => {
                  res.status(200).send(craftRequest(200));
                });
              } else {
                res.status(403).send(craftRequest(403));
              }
            }
          );
        }
      });
    } else {
      console.log("this occured #2");
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log("this occured #3");
    console.log(e);
    reportError(400);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/createCategory", (req,res) => {
    try {
        const { category } = req.body;
        if (category !== null && category !== undefined && isString(category, 100)) {
                console.log("this occured #1");
          
                    locateEntry("uuid", "SCHOOLNAMES", process.env.DYNAMO_SECONDARY, false, "schoolName", category.toLowerCase().trim()).then(
                        (school) => {
                            if (school !== null) {
                                res.status(200).send(craftRequest(200, "this already exists"));
                            } else {
                                addEntry({uuid: "SCHOOLNAMES", schoolName: category.toLowerCase().trim(), allOrganizations: [], categoryId: v4() }, process.env.DYNAMO_SECONDARY).then(() => {
                                    res.status(200).send(craftRequest(200));
                                })
                            }
                        }
                    );
                
         
        } else {
            console.log("this occured #2");
            res.status(400).send(craftRequest(400));
        }
    } catch(e) {
        console.log(e);
        reportError(e);
        res.status(400).send(craftRequest(400));
    }
})


// app.get("/payout", (req,res) => {
//   try {
//     authenticateUser(req).then((id) => {
//       if (id === "No user found") {
//         res.status(403).send(craftRequest(403));
//       } else {

//         locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(async(school) => {
//           if (school !== null) {
            

            

//             if ((school.lastWithdraw===null||(Math.abs(Number(school.lastWithdraw) - Date.now()) > 1000*60*60*24*5))&&(school.amountAvailable>20)) {

//                 // Do the payout 
//                 // const transferAmount = calculateTransfer(school.amountAvailable, school.ticketsUsed)

//               try {
                
//                 const payout = await stripe.payouts.create({
//                   amount: school.amountAvailable*100,
//                   currency: "usd",
//                   destination: school.stripeId
//                 })
                


//                 updateEntry("uuid", id, {amountAvailable: 0, ticketsUsed: 0, lastWithdraw: Date.now()}, process.env.DYNAMO_SECONDARY).then(() => {
//                   res.status(200).send(craftRequest(200));
                
//                 })

                

//               } catch(e) {
//                 console.log(e);
//                 res.status(400).send(craftRequest(400, "Your payout was invalid"))
//               }
                

//             } else if (Math.abs(Number(school.lastWithdraw) - Date.now()) < 1000*60*60*24*5) {
//               res.status(400).send(craftRequest(400, "Too early to request another payout"))
//             } else if (school.amountAvailable<20) {
//               res.status(400).send(craftRequest(400, "Need at least $20.00 to request payout"))
//             }
//             else {
//               console.log("did this happen")
//               res.status(400).send(craftRequest(400))

//             }




//           } else {
            

//             res.status(400).send(craftRequest(400));


//           }

//         })



//       }
//     })


//   } catch(e) {
//     console.log(e);
//     reportError(e);


//     res.status(400).send(craftRequest(400));


//   }


// })


app.get("/sitemap", async(req,res) => {
    res.sendFile(__dirname + "/sitemap.xml")
})







app.post("/schoolSearch", (req, res) => {
  try {
    const { query, schoolOnly } = req.body;
    if (typeof query === "string" && query.length >= 2 && typeof schoolOnly === "boolean") {
      searchEntry(
        "uuid",
        schoolOnly ? "SCHOOLNAMES" : "PERSONALNAMES"
        ,
        "schoolName",
        query.toLowerCase(),
        process.env.DYNAMO_SECONDARY
      ).then((entries) => {
        if (entries !== null && Array.isArray(entries)) {
          res.status(200).send(craftRequest(200, entries));
        } else {
          console.log("adf");
          res.status(400).send(craftRequest(400));
        }
      });
    } else {
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.get("/getFinancials", (req, res) => {
  authenticateUser(req).then((id) => {
    if (id === "No user found") {
      res.status(404).send(craftRequest(404));
    } else {
      locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then((school) => {
        if (school != null) {
          const body = {
            totalRevenue: 0,
            ticketsSold: 0,
            amountAvailable: school.amountAvailable,
            lastWithdraw: school.lastWithdraw,
          };
          if (school.events !== null) {
            console.log("SCHOOL EVENTS", school.events);
            for (const i in school.events) {
              const event = school.events[i];
              // console.log("current event", event)
              if (event.totalRevenue && event.ticketsSold) {
                body.totalRevenue += Number(event.totalRevenue);
                body.ticketsSold += Number(event.ticketsSold);
              }
              console.log(body);
            }
          }
          console.log("FINAL BODY", body);
          res.status(200).send(craftRequest(200, body));
        } else {
          res.status(404).send(craftRequest(404));
        }
      });
    }
  });
});

app.get("/deleteAccount", (req, res) => {
  // This is the thing about this account.

  function deleteAccount(id, dbName, val) {
    return new Promise((resolve) => {
      updateEntry("uuid", id, { isDelete: val }, dbName).then(() => {
        resolve();
      });
    });
  }

  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
        locateEntry("uuid", id).then((user) => {
          if (user !== null) {
            if (user.isDelete && user.isDelete !== null) {
              deleteAccount(user.uuid, process.env.DYNAMO_NAME, null).then(
                () => {
                  res.status(200).send(
                    craftRequest(200, {
                      message: "Your account has been recovered",
                    })
                  );
                }
              );
            } else {
              deleteAccount(
                user.uuid,
                process.env.DYNAMO_NAME,
                Date.now()
              ).then(() => {
                res.status(200).send(
                  craftRequest(200, {
                    message: "Your account will be deleted in 14 days",
                  })
                );
              });
            }
          } else {
            locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(
              (user) => {
                if (user !== null) {
                  if (user.isDelete && user.isDelete !== null) {
                    deleteAccount(
                      user.uuid,
                      process.env.DYNAMO_SECONDARY,
                      null
                    ).then(() => {
                      res.status(200).send(
                        craftRequest(200, {
                          message: "Your account has been recovered",
                        })
                      );
                    });
                  } else {
                    deleteAccount(
                      user.uuid,
                      process.env.DYNAMO_SECONDARY,
                      Date.now()
                    ).then(() => {
                      res.status(200).send(
                        craftRequest(200, {
                          message: "Your account will be deleted in 14 days",
                        })
                      );
                    });
                  }
                } else {
                  res.status(400).send(craftRequest(400));
                }
              }
            );
          }
        });
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

// Finish this later
app.post("/batchCreate", (req, res) => {
  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(403).send(craftRequest(403));
      } else {
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.get("/signout", (req, res) => {
  try {
    authenticateUser(req).then((id) => {
      console.log("No user found");
      if (id === "No user found") {
        res.status(400).send(craftRequest(400));
      } else {
        // bookmark
        removeCookie(req,res);


        res.status(200).send(craftRequest(200));
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

// This sends the email which would make the security emails.
app.post("/sendSecurity", (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email === "string" && isEmail(email)) {
      authenticateUser(req).then((id) => {
        if (id === "No user found") {
          res.status(400).send(craftRequest(400));
        } else {
          locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(
            async (school) => {
              if (school !== null) {
                locateEntry(
                  "emailHash",
                  md5(email.toLowerCase()),
                  process.env.DYNAMO_FOURTH
                ).then(async ({ query }) => {

                    const user = query[0]
                  if (query !== null && query.length > 0) {



                    console.log("query", query);
                    const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Invitation Email</title>
        </head>
        <body style="margin:0; padding:0; background-color:#121212; color:#ffffff; font-family:Arial, sans-serif;">
          <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:auto;">
            <tr>
              <td style="padding:40px 30px; background-color:#1e1e1e; border-radius:8px;">
                <h2 style="color:#ffffff; margin-top:0;">Hello,</h2>
                <p style="font-size:16px; line-height:1.5; color:#cccccc;">
                  You were invited by <strong style="color:#ffffff;">${cmod.decrypt(
                    school.name
                  )}</strong> to become a security guard.
                </p>
                <p style="font-size:16px; line-height:1.5; color:#cccccc;">
                  To be able to scan tickets, please finish creating your account by clicking the button below:
                </p>
                <div style="text-align:center; margin:30px 0;">
                  <a href="${
                    process.env.NODE_ENV==="DEV"
                      ? "http://localhost:5173/createSecurity/" + user.uuid
                      : "https://ticketnest.us/createSecurity/" + user.uuid
                  }" style="background-color:#4CAF50; color:#ffffff; padding:14px 24px; text-decoration:none; font-size:16px; border-radius:5px; display:inline-block;">
                    Finish Creating Account
                  </a>
                </div>
                <p style="font-size:12px; color:#777777; text-align:center;">
                  If you did not expect this email, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
        
        `;
                    sendEmail(
                      email.trim(),
                      "Create Security Account for ticketnest",
                      html
                    ).then(() => {
                      res.status(200).send(craftRequest(200));
                    });
                  } else {
                    const uuid = v4();
                    const newThing = {
                      uuid: uuid,
                      schoolId: id,
                      emailHash: md5(email.toLowerCase()),
                      email: cmod.encrypt(email.toLowerCase()),
                    };

                    const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Invitation Email</title>
        </head>
        <body style="margin:0; padding:0; background-color:#121212; color:#ffffff; font-family:Arial, sans-serif;">
          <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:auto;">
            <tr>
              <td style="padding:40px 30px; background-color:#1e1e1e; border-radius:8px;">
                <h2 style="color:#ffffff; margin-top:0;">Hello,</h2>
                <p style="font-size:16px; line-height:1.5; color:#cccccc;">
                  You were invited by <strong style="color:#ffffff;">${cmod.decrypt(
                    school.name
                  )}</strong> to become a security guard.
                </p>
                <p style="font-size:16px; line-height:1.5; color:#cccccc;">
                  To be able to scan tickets, please finish creating your account by clicking the button below:
                </p>
                <div style="text-align:center; margin:30px 0;">
                  <a href="${
                    process.env.NODE_ENV==="DEV"
                      ? "http://localhost:5173/createSecurity/" + uuid
                      : "https://ticketnest.us/createSecurity/" + uuid
                  }" style="background-color:#4CAF50; color:#ffffff; padding:14px 24px; text-decoration:none; font-size:16px; border-radius:5px; display:inline-block;">
                    Finish Creating Account
                  </a>
                </div>
                <p style="font-size:12px; color:#777777; text-align:center;">
                  If you did not expect this email, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
        
        `;
                    addEntry(newThing, process.env.DYNAMO_FOURTH).then(() => {
                      sendEmail(
                        email.trim(),
                        "Create Security Account for ticketnest",
                        html
                      ).then(() => {
                        res.status(200).send(craftRequest(200));
                      });
                    });
                  }
                });
              } else {
                res.status(400).send(craftRequest(400));
              }
            }
          );
        }
      });
    } else {
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/createSecurity", (req, res) => {
  try {
    const { name, uuid, password } = req.body;

    if (isString(name) && uuid && isPassword(password)) {
      bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) {
          console.log(2);
          res.status(400).send(craftRequest(400));
          reportError(err);
        } else {
          locateEntry("uuid", uuid, process.env.DYNAMO_FOURTH).then(
            (security) => {
              if (security !== null) {
                console.log("this is here", name);
                updateEntry(
                  "uuid",
                  uuid,
                  {
                    name: cmod.encrypt(formatString(name.toLowerCase())),
                    password: hash,
                  },
                  process.env.DYNAMO_FOURTH
                ).then(() => {
                  // Potential Vulnerability here as we aren't even checking if the uuid is valid yet we are still trying to update it.
                  setCookie(req,res,uuid);
                  res.status(200).send(craftRequest(200));
                });
              } else {
                console.log(3);
                res.status(400).send(craftRequest(400));
              }
            }
          );
        }
      });
    } else {
      console.log(1);
      res.status(400).send(craftRequest(400));
    }
  } catch (e) {
    console.log(e);
    reportError(e);

    res.status(400).send(craftRequest(400));
  }
});

app.get("/getSecurity", (req, res) => {
  try {
    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(400).send(craftRequest(400));
      } else {
        try {
          locateEntry("schoolId", id, process.env.DYNAMO_FOURTH).then(
            ({ query }) => {
              // console.log("This is the query", query)
              const allSecurity = query;

              res.status(200).send(
                craftRequest(
                  200,
                  allSecurity.map((person) => ({
                    email: cmod.decrypt(person.email),
                    name: person.name ? cmod.decrypt(person.name) : null,
                    uuid: person.uuid,
                    hasCompleted: person.name ? true : false,
                  }))
                )
              );
            }
          );
        } catch (e) {
          res.status(200).send(craftRequest(200, []));
        }
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});

app.post("/deleteSecurity", (req, res) => {
  try {
    const { uuid } = req.body;

    authenticateUser(req).then((id) => {
      if (id === "No user found") {
        res.status(400).send(craftRequest(400));
      } else {
        locateEntry("uuid", uuid, process.env.DYNAMO_FOURTH).then((user) => {
          if (user.schoolId === id) {
            removeEntry("uuid", uuid, process.env.DYNAMO_FOURTH).then(() => {
              res.status(200).send(craftRequest(200));
            });
          } else {
            res.status(400).send(craftRequest(400));
          }
        });
      }
    });
  } catch (e) {
    console.log(e);
    reportError(e);
    res.status(400).send(craftRequest(400));
  }
});






app.get("/getFinancialsGraph", (req,res) => {

    try {
        console.log(req.query)
        // console.log("this is the query", req.query.timeInterval)
        const allowedDays = [7,30,365]
        const timeInterval = req.query.timeInterval;

        authenticateUser(req).then((id) => {
            if (id === "No user found") {
                console.log("no user found")
                res.status(400).send(craftRequest(400));
            } else {
                console.log("this is the time interval", timeInterval);
                console.log("this is the first check", allowedDays.includes(Number(timeInterval)));
                if (allowedDays.includes(Number(timeInterval))) {
                    locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then(async(school) => {
                        if (school!==null) {
                            

                          

                            console.log("this is the school", school);
                            const events = school.events || [];
                            const datesUsed = []
                            const addedData = []
                            for (let i=0; i<timeInterval; i++) {
                                console.log("this is happening right now")
                                datesUsed.push(new Date(Date.now() - (i*24*60*60*1000)).toLocaleDateString("en-US", {
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit"
                                }))
                                addedData.push({
                                    date: datesUsed[i],
                                    amount: 0
                                })


                            }

                            for (let i=0; i<events.length; i++) {
                                const currEvent = events[i];
                                const currId = events[i].id;
                                // console.log("this is the first event being tried")

                                if (Math.abs(Date.now()-cmod.decrypt(currEvent.startDate)) < Number(timeInterval)*24*60*60*1000) {
                                    await locateEntry("eventId", currId, process.env.DYNAMO_THIRD).then(({query}) => {
                                        console.log("first batch of tickets being logged", query);
                                        const tickets = query;
                                        tickets.forEach((ticket) => {
                                          console.timeLog("this is the ticket", ticket)
                                            const ticketDate = new Date(ticket.dateBought).toLocaleDateString("en-US", {
                                                year: "numeric",
                                                month: "2-digit",
                                                day: "2-digit"
                                            })
                                            const idx = datesUsed.indexOf(ticketDate);
                                            if (idx !== -1) {
                                                addedData[idx].amount += ticket.price
                                            } else {
                                                datesUsed.push(ticketDate)
                                                addedData.push({
                                                    date: ticketDate,
                                                    amount: ticket.price
                                                })
                                            }
                                        })
                                        console.log("this is the added data", addedData);
                                        
                                        
                                        

    
    
    
                                    })
    


                                }  else {
                                    console.log('failed the bought time check')
                                }
                               

                               


                            }


                            console.log('we just cleared everything')
                            res.status(200).send(craftRequest(200, addedData));




                        } else {
                            res.status(400).send(craftRequest(400));
                        }
                    })




                }  else {
                    res.status(400).send(craftRequest(400));
                }
            
            }

        })
        



    } catch(e) {
        console.log(e);
        reportError(e);
        res.status(400).send(craftRequest(400));
    }









})







app.get("/eventSearch", (req,res) => {

    try {

        authenticateUser(req).then((id) => {
            if (id === "No user found") {
                res.status(400).send(craftRequest(400));
            } else {
                locateEntry("uuid", id, process.env.DYNAMO_SECONDARY).then((school) => {
                    if (school !== null) {
                        const events = school.events || [];
                        const {query} = req.query;
                        const filteredEvents = events.filter((event) => {

                            
                            return cmod.decrypt(event.name).toLowerCase().includes(query.toLowerCase())
                        })
                        res.status(200).send(craftRequest(200, filteredEvents));
                    } else {
                        res.status(400).send(craftRequest(400));
                    }


                })

            }


        })


    } catch(e) {
        console.log(e);
        reportError(e);
        res.status(400).send(craftRequest(400));
    }


})



















server.listen(process.env.PORT, () => {
  console.log("Listening on port:", process.env.PORT);
});

// body-parser
// app.use(bodyParser.json())

// async function register(name, email, password)

// const name = req.body.name;
// const email = req.body.email;
// const password = req.body.email;
// const etrasdf = req.body.email;
// ...

// {name: "bob", email: "asdf@gmail.com", password: "asdfasdf"};

// const {name, email, password, etrasdf} = req.body;

// POST

//

// /login
// POST

// /getUser         getUser() {}
// GET

// /getTickets

// /changePassword

// POST

// /confirmEmail

//
