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

async function sendTemplateEmail(recipient, title, dataPack, {templateName="", baseHTML="", templateHTML="", completedHTML=""}){
  let templateBar;
  if(completedHTML === ""){
    let baseTemplate;
    if(baseHTML === ""){
      baseTemplate = await retrieveTemplate("base");
      baseTemplate = baseTemplate.template;
    }
    else{
      baseTemplate = baseHTML;
    }
    
    let completedTemplate;
    if(templateHTML === ""){
      completedTemplate = await assembleTemplate(baseTemplate, templateName);
    }
    else {
      completedTemplate = templateHTML;
    }
    
    templateBar = handlebars.compile(completedTemplate);
    
  }
  else {
    templateBar = handlebars.compile(templateHTML);
  }
  
  let templateFinal = templateBar(dataPack);
  
  var email_message = {//construct the message
      from: process.env.EMAIL_CONTACT,
      to: recipient,
      subject: title,
      text: 'Your email client does not support the viewing of HTML emails. Please consider enabling HTML emails in your settings, or downloading a client capable of viewing HTML emails.',
      html: templateFinal
  };

  transporter.sendMail(email_message, function(error,response){//send the email
      if(error){
          console.log(error,response);
      }
      else{
          console.log('email sent');
      }
  });
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

async function clearEmailQueue(name){
  dbo.collection("queuedemails").find({"template": name}, function(err, queuedEmails){
    let baseTemplate = await retrieveTemplate("base");
    let templateHTML = await retrieveTemplate(name);
    let completedTemplate = baseTemplate.replace('{{emailData}}',template.template);
    
    for(let i=0;i<queuedEmails.length;i++){
      sendTemplateEmail(queuedEmails[i]["email"], queuedEmails[i]["title"], queueEmails[i]["data"], {"completedHTML": completedTemplate})
    }
  })
}

async function clearAllEmals(){
  dbo.collection("queuedemails").find({}, function(err, queuedEmails){
    let baseTemplate = await retrieveTemplate("base");
    let templateHTML;
    let cache = {};
    
    for(let i=0;i<queuedEmails.length;i++){
      if(!cache.hasOwnProperty(queuedEmails[i]["template"])){
        cache[queuedEmails[i]["template"]] = await retrieveTemplate(queuedEmails[i]["template"]);
      }
      templateHTML = cache[queuedEmails[i]["template"]];
      sendTemplateEmail(queuedEmails[i]["email"], queuedEmails[i]["title"], queuedEmails[i]["data"], {"baseHTML": baseTemplate, "templateHTML": templateHTML});
    }
  })
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
            sendTemplateEmail(request["data"]["recipient"], request["data"]["title"], request["data"]["datapack"], {"templateName": request["data"]["template"]});
            break;
          case 'email.clearqueue':
            clearEmailQueue(request["data"]["queue"]);
            break;
          case 'email.clearall':
            clearAllEmals();
            break;
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