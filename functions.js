const nodemailer = require("nodemailer");
require("dotenv").config();
const jwt = require('jsonwebtoken');
const fs = require("fs")
const cookieParser = require("cookie-parser")
function authenticateUser(req) {
  return new Promise(async(resolve) => {

    const jwtCookie = cookieParser.JSONCookies(req.cookies)?.jwt;
    // console.log("All Cookies", jwtCookie)
    

    // console.log("All cookies", cookieParser.JSONCookies(req.cookies))
    if (jwtCookie!==undefined&&jwtCookie!==null) {
      try {
        const payload = jwt.verify(jwtCookie, process.env.COOKIE_SECRET,)
        console.log("here's the payload", payload)
        resolve(payload.uuid);
      } catch(e) {
        console.log(e);
        resolve("No user found");
      }
    
    } else {
      resolve("No user found")
    }



    // let sessionId = req.sessionID;

    // if (!sessionId) {
    //   resolve("No user found");
    // } else {
    //   req.sessionStore.get(sessionId, (err, session) => {
    //     if (err) {
    //       console.log(err);
    //       resolve("No user found");
    //     } else {
    //       if (!session) {
    //         resolve("No user found");
    //       } else {
    //         const currentUser = session.user;
    //         if (!currentUser) {
    //           resolve("No user found");
    //         } else {
    //           resolve(currentUser);
    //         }
    //       }
    //     }
    //   });
    // }
  });
}

async function sendEmail(to, subject, text) {
  return new Promise(async (resolve) => {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        // TODO: replace `user` and `pass` values from <https://forwardemail.net>
        user: process.env.EMAIL_SENDER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
    if (to.length > 0 && subject.length > 0 && text.length > 0) {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_SENDER, // sender address
        to: to, // list of receivers
        subject: subject, // Subject line
        html: text,
      });

      resolve(true);
    } else {
      resolve(false);
    }
  });
}

async function reportError(err) {
  if (err.length > 0) {
    await sendEmail(process.env.EMAIL_PERSONAL, "Report Bug #", err);
    return true;
  } else {
    return false;
  }
}

function isEmail(email) {
  let passedTests = true;

  if (email.split("@").length !== 2) {
    passedTests = false;
  } else if (email.length < 4) {
    passedTests = false;
  } else if (email.length > 40) {
    passedTests = false;
  }

  return passedTests;
}

function isPassword(password) {
  let passedTests = true;

  if (password.length < 4) {
    passedTests = false;
  } else if (password.length > 15) {
    passedTests = false;
  }

  return passedTests;
}

function isString(s, lengthLimit = 1000000, checkWhitespace=false, checkSymbols=false) {
  const string = String(s);
  // for (let i=0; i<string.length; i++) {
  //     if (!isNaN(string[i])) {
  //         return false;
  //     }

  if (s !== undefined && s !== null && string.length < lengthLimit) {

    if (checkWhitespace) {
     
      for (let i = 0; i < string.length; i++) {
        if (string[i] === " ") {
          return false;
        }
      }
    }

    if (checkSymbols&&s.match(/[|\\/~^:,;?!&%$@*+]/)) {
      return false;
    }


    return true;
  } else {
    return false;
  }
  // }
}

function isNumber(number, lengthLimit = 100000) {
  const string = String(number);
  for (let i = 0; i < string.length; i++) {
    if (isNaN(string[i])) {
      return false;
    }
  }

  if (string.length < lengthLimit) {
    return true;
  } else {
    return false;
  }
}

function generateCode(length) {
  let code = ""; // Initialize code as an empty string
  const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  for (let i = 0; i < length; i++) {
    code += String(numbers[Math.floor(Math.random() * numbers.length)]); // Fix off-by-one error
  }

  return code;
}

function craftRequest(code, body) {
  if (code === 403 || code === 404 || code === 400) {
    return JSON.stringify({
      code: "err",
      message: JSON.stringify(body) || "invalid request",
    });
  } else if (code === 200) {
    return JSON.stringify({
      code: "ok",
      message: JSON.stringify(body) || "success",
    });
  } else if (code === 307) {
    return JSON.stringify({
      code: "ok",
      message: JSON.stringify(body) || "login",
    });
  } else {
    ("code not found");
  }
}

function setCookie(req, res, uuid) {
  return new Promise((resolve) => {
    
  if (req && uuid) {
    // console.log(fs.readFileSync('jwtKey.txt'))
    res.cookie("jwt", jwt.sign({uuid: uuid}, process.env.COOKIE_SECRET, {expiresIn: "1 day"}))


    // req.session.user = uuid;
    resolve(true);
  } else {
    resolve(false);
  }



  })
}

function removeCookie(req,res) {
  res.clearCookie("jwt")
  return;

}

function formatString(string) {
  return string
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}



function calculateTransfer(totalRevenue, ticketsSold) {
  return Number(totalRevenue) - (Number(ticketsSold) * 0.2)
}

module.exports = {
  authenticateUser,
  isNumber,
  reportError,
  sendEmail,
  isEmail,
  isPassword,
  craftRequest,
  isString,
  setCookie,
  generateCode,
  formatString,
  calculateTransfer,
  removeCookie
};
