require('dotenv').config();
const amqp = require('amqplib/callback_api');
const bindings = ["#"];

const MongoClient = require('mongodb').MongoClient;
const url = process.env.DATABASE;
let dbo;

const nodemailer = require('nodemailer');
const handlebars = require('handlebars');

var smtpConfig = {
    host: user: process.env.EMAIL_HOST,
    port: user: process.env.EMAIL_PORT,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
};

const transporter = nodemailer.createTransport(smtpConfig);
transporter.verify(function(error, success) {
  if (error) {
    console.log(error);
  } else {
    console.log("Email setup");
  }
});

function deleteInactive() {
  let now = Date.now();
  dbo.collection("users").deleteMany({ 
    $or: [ { 
      "status.active": false 
    }, 
    { 
      "status.passwordSuspension": true 
    }, 
    { 
      $and: [ { 
        "permissions.developer": false 
      }, 
      { 
        "permissions.owner": false 
      }, 
      { 
        "permissions.reviewer": false 
      }, 
      { 
        "permissions.admin": false 
      }, 
      { 
        "permissions.checkin": false 
      }, 
      { 
        "permissions.verified": false 
      } ] 
    } ], 
    "timestamp": { 
      $lt: now - 86400000 
    } 
}, function(err, obj){
      console.log("Hello!");
      console.log(obj.result.n);
    });
}

function sendEmail(params, template){
  let templateBar = handlebars.compile(template);
  htmlEmail = template(params)
}

async function sendTemplateEmail(params, templateName, baseHTML = "", templateHTML = ""){
  let baseTemplate;
  if(baseHTML === ""){
    baseTemplate = await retrieveTemplate("base");
    baseTemplate = baseTemplate.template;
  }
  else{
    baseTemplate = baseHTML;
  }
  
  console.log("here");
  
  let completedTemplate;
  if(templateHTML === ""){
    completedTemplate = await assembleTemplate(baseTemplate, templateName);
  }
  else {
    completedTemplate = templateHTML;
  }
  
  let templateBar = handlebars.compile(completedTemplate);
  let templateFinal = templateBar(params);
  console.log("sgasg");
  console.log(templateFinal);
}


function assembleTemplate(baseTemplate, templateName){
  return new Promise(function (resolve, reject){
    dbo.collection("emailtemplates").findOne({
    "name": templateName
  }, function(err, template){
    if(err){
      reject(err);
    }
    resolve(baseTemplate.replace('{{emailData}}',template.template))
  })
  })
  
}

function retrieveTemplate(name){
  return new Promise(function (resolve, reject) {
    dbo.collection("emailtemplates").findOne({
      "name": name
    }, function(err, template){
      if(err){
        reject(err);
      }
      resolve(template);
    })
  });
  
}

let handleMap = {
  "cleanup": deleteInactive
}

MongoClient.connect(url, function(err, db) {
  if (err) {
    console.log("Error!");
  };
  dbo = db.db("goose");
});

amqp.connect(process.env.AMQP_URL, function(error0, connection) {
  if (error0) {
    throw error0;
  }
  connection.createChannel(function(error1, channel) {
    if (error1) {
      throw error1;
    }
    var exchange = 'goose_tasks';

    channel.assertExchange(exchange, 'topic', {
      durable: true
    });

    channel.assertQueue('', {
      exclusive: true
    }, function(error2, q) {
      if (error2) {
        throw error2;
      }
      channel.prefetch(1);
      console.log(' [*] Waiting for messages. To exit press CTRL+C');

      bindings.forEach(function(key) {
        channel.bindQueue(q.queue, exchange, key);
      });

      channel.consume(q.queue, async function(msg) {
        console.log(msg);
        const request = JSON.parse(msg.content.toString());
        
        
        switch (request["command"]) {
          case 'users.cleanup':
            deleteInactive();
            break;
          case 'email.templateassemble':
            retrieveTemplate(request["data"]["name"]);
            break;
          case 'email.send':
            sendTemplateEmail(request["data"]["variables"], request["data"]["name"])
          default:
            // code
        }
        
        channel.ack(msg);
      }, {
        noAck: false
      });
    });
  });
});