require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const CryptoJS = require("crypto-js");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FacebookStrategy = require("passport-facebook");
const findOrCreate = require("mongoose-findorcreate");
const app = express();

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");

app.use(
  session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

mongoose.set("strictQuery", false);
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
});

const secretSchema = new mongoose.Schema({
  content: String,
});

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    sparse: true,
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
  },
  facebookId: {
    type: String,
    unique: true,
    sparse: true,
  },
  secret: [secretSchema],
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);
passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL:
        "https://secrets-website-practice-project-production.up.railway.app/auth/google/secrets",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },

    function (accessToken, refreshToken, profile, cb) {
      User.findOrCreate({ googleId: profile.id }, function (err, user) {
        return cb(err, user);
      });
    }
  )
);

passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL:
        "https://secrets-website-practice-project-production.up.railway.app/auth/facebook/secrets",
    },
    function (accessToken, refreshToken, profile, cb) {
      User.findOrCreate({ facebookId: profile.id }, function (err, user) {
        return cb(err, user);
      });
    }
  )
);

app.get("/", (req, res) => {
  res.render("home");
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile"] })
);

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function (req, res) {
    // Successful authentication, redirect to secrets.
    res.redirect("/secrets");
  }
);
app.get("/auth/facebook", passport.authenticate("facebook"));

app.get(
  "/auth/facebook/secrets",
  passport.authenticate("facebook", { failureRedirect: "/login" }),
  function (req, res) {
    // Successful authentication, redirect home.
    res.redirect("/secrets");
  }
);

app.get("/login", (req, res) => {
  res.render("login");
});
app.get("/register", (req, res) => {
  res.render("register");
});

app.get("/secrets", (req, res) => {
  User.find({ secret: { $ne: null } }, (err, foundUsers) => {
    if (err) {
      console.log(err);
    } else {
      if (foundUsers) {
        const decryptedSecrets = foundUsers.map((user) => {
          const decryptedUser = { ...user.toObject() };
          decryptedUser.secret = user.secret.map((secret) => {
            const bytes = CryptoJS.AES.decrypt(
              secret.content,
              process.env.ENCRYPTION_KEY,
              {
                keySize: 256,
              }
            );
            const originalSecret = bytes.toString(CryptoJS.enc.Utf8);
            return { content: originalSecret };
          });
          return decryptedUser;
        });

        res.render("secrets", {
          usersWithSecrets: decryptedSecrets,
          userId: req.user._id,
        });
      }
    }
  });
});

app.get("/submit", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("submit");
  } else {
    res.redirect("/login");
  }
});

app.post("/submit", (req, res) => {
  const submittedSecret = req.body.secret;

  // Encryption
  const encryptedSecret = CryptoJS.AES.encrypt(
    submittedSecret,
    process.env.ENCRYPTION_KEY,
    {
      keySize: 256,
    }
  ).toString();

  User.findById(req.user.id, (err, foundUser) => {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        foundUser.secret.push({ content: encryptedSecret });
        foundUser.save(() => {
          res.redirect("/secrets");
        });
      }
    }
  });
});

app.get("/secrets/:userId", (req, res) => {
  const userId = req.params.userId;
  User.findOne({ _id: userId }, (err, foundUser) => {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        if (req.isAuthenticated()) {
          const decryptedSecrets = foundUser.secret.map((secret) => {
            const bytes = CryptoJS.AES.decrypt(
              secret.content,
              process.env.ENCRYPTION_KEY,
              {
                keySize: 256,
              }
            );
            const originalSecret = bytes.toString(CryptoJS.enc.Utf8);
            return { content: originalSecret };
          });

          res.render("userSecrets", { SECRET: decryptedSecrets });
        } else {
          res.redirect("/login");
        }
      }
    }
  });
});

app.get("/logout", (req, res) => {
  req.logout((e) => {
    if (e) {
      console.log(e);
    } else {
      res.redirect("/");
    }
  });
});

app.post("/register", (req, res) => {
  User.register(
    { username: req.body.username },
    req.body.password,
    (err, user) => {
      if (err) {
        console.log(err);
        res.redirect("/register");
      } else {
        passport.authenticate("local")(req, res, () => {
          res.redirect("/secrets");
        });
      }
    }
  );
});

app.post("/login", (req, res) => {
  const user = new User({
    username: req.body.username,
    password: req.body.password,
  });

  req.login(user, (err) => {
    if (err) {
      console.log(err);
    } else {
      passport.authenticate("local")(req, res, () => {
        res.redirect("/secrets");
      });
    }
  });
});
let port = process.env.PORT;
if (port == null || port == "") {
  port = 3000;
}

app.listen(port, () =>
  console.log(`Server has started on port ${port} successfully !`)
);
