const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const users = db.collection('users');
const documents = db.collection('documents');
const ocrTasks = db.collection('ocr_tasks');

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    username: user.username,
    avatar: user.avatar || '',
    securityQuestion: user.securityQuestion || '',
    createdAt: user.createdAt || ''
  };
}

function hashValue(value, salt) {
  return crypto.pbkdf2Sync(value, salt, 10000, 64, 'sha512').toString('hex');
}

function createHashRecord(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt,
    hash: hashValue(value, salt)
  };
}

function verifyHash(value, salt, hash) {
  if (!salt || !hash) {
    return false;
  }
  return hashValue(value, salt) === hash;
}

async function findUserByUsername(username) {
  const { data } = await users.where({
    username
  }).limit(1).get();

  return data[0] || null;
}

async function upgradeLegacySecrets(user, password, securityAnswer) {
  const data = {};

  if (password && !user.passwordHash && user.password === password) {
    const nextPassword = createHashRecord(password);
    data.passwordHash = nextPassword.hash;
    data.passwordSalt = nextPassword.salt;
    data.password = db.command.remove();
  }

  if (securityAnswer && !user.securityAnswerHash && user.securityAnswer === securityAnswer) {
    const nextAnswer = createHashRecord(securityAnswer);
    data.securityAnswerHash = nextAnswer.hash;
    data.securityAnswerSalt = nextAnswer.salt;
    data.securityAnswer = db.command.remove();
  }

  if (Object.keys(data).length) {
    await users.doc(user._id).update({ data });
  }
}

async function verifyPassword(user, password) {
  if (user.passwordHash) {
    return verifyHash(password, user.passwordSalt, user.passwordHash);
  }

  const matched = user.password === password;
  if (matched) {
    await upgradeLegacySecrets(user, password);
  }
  return matched;
}

async function verifySecurityAnswer(user, answer) {
  if (user.securityAnswerHash) {
    return verifyHash(answer, user.securityAnswerSalt, user.securityAnswerHash);
  }

  const matched = user.securityAnswer === answer;
  if (matched) {
    await upgradeLegacySecrets(user, undefined, answer);
  }
  return matched;
}

async function handleRegister(event) {
  const { username, password, securityQuestion, securityAnswer } = event;
  const existedUser = await findUserByUsername(username);

  if (existedUser) {
    return { ok: false, message: '账号已存在，请换一个用户名' };
  }

  const passwordRecord = createHashRecord(password);
  const answerRecord = createHashRecord(securityAnswer);
  const createdAt = new Date();

  const result = await users.add({
    data: {
      username,
      avatar: '',
      securityQuestion,
      createdAt,
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
      securityAnswerHash: answerRecord.hash,
      securityAnswerSalt: answerRecord.salt
    }
  });

  return {
    ok: true,
    user: sanitizeUser({
      _id: result._id,
      username,
      avatar: '',
      securityQuestion,
      createdAt
    })
  };
}

async function handleLogin(event) {
  const { username, password } = event;
  const user = await findUserByUsername(username);

  if (!user || !(await verifyPassword(user, password))) {
    return { ok: false, message: '账号或密码不正确' };
  }

  return {
    ok: true,
    user: sanitizeUser(user)
  };
}

async function handleGetSecurityQuestion(event) {
  const user = await findUserByUsername(event.username);
  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  return {
    ok: true,
    securityQuestion: user.securityQuestion || ''
  };
}

async function handleResetPassword(event) {
  const { username, securityAnswer, nextPassword } = event;
  const user = await findUserByUsername(username);

  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  if (!(await verifySecurityAnswer(user, securityAnswer))) {
    return { ok: false, message: '密保答案不正确' };
  }

  const passwordRecord = createHashRecord(nextPassword);
  await users.doc(user._id).update({
    data: {
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
      password: db.command.remove()
    }
  });

  return { ok: true };
}

async function handleUpdatePassword(event) {
  const { username, oldPassword, nextPassword } = event;
  const user = await findUserByUsername(username);

  if (!user || !(await verifyPassword(user, oldPassword))) {
    return { ok: false, message: '当前密码不正确' };
  }

  const passwordRecord = createHashRecord(nextPassword);
  await users.doc(user._id).update({
    data: {
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
      password: db.command.remove()
    }
  });

  return { ok: true };
}

async function handleUpdateSecurity(event) {
  const { username, password, securityQuestion, securityAnswer } = event;
  const user = await findUserByUsername(username);

  if (!user || !(await verifyPassword(user, password))) {
    return { ok: false, message: '密码校验失败' };
  }

  const answerRecord = createHashRecord(securityAnswer);
  await users.doc(user._id).update({
    data: {
      securityQuestion,
      securityAnswerHash: answerRecord.hash,
      securityAnswerSalt: answerRecord.salt,
      securityAnswer: db.command.remove()
    }
  });

  return {
    ok: true,
    user: sanitizeUser({
      ...user,
      securityQuestion
    })
  };
}

async function handleUpdateAvatar(event) {
  const { username, avatar } = event;
  const user = await findUserByUsername(username);

  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  await users.doc(user._id).update({
    data: {
      avatar
    }
  });

  return {
    ok: true,
    user: sanitizeUser({
      ...user,
      avatar
    })
  };
}

async function handleDeleteAccount(event) {
  const { userId, username } = event;
  const user = userId ? await users.doc(userId).get().then((res) => res.data).catch(() => null) : await findUserByUsername(username);

  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  const { data } = await documents.where({
    userId: user._id
  }).get();
  const { data: taskData } = await ocrTasks.where({
    userId: user._id
  }).get();

  await Promise.all(data.map((doc) => documents.doc(doc._id).remove()));
  await Promise.all(taskData.map((task) => ocrTasks.doc(task._id).remove()));
  await users.doc(user._id).remove();

  return { ok: true };
}

exports.main = async (event) => {
  switch (event.action) {
    case 'register':
      return handleRegister(event);
    case 'login':
      return handleLogin(event);
    case 'getSecurityQuestion':
      return handleGetSecurityQuestion(event);
    case 'resetPassword':
      return handleResetPassword(event);
    case 'updatePassword':
      return handleUpdatePassword(event);
    case 'updateSecurity':
      return handleUpdateSecurity(event);
    case 'updateAvatar':
      return handleUpdateAvatar(event);
    case 'deleteAccount':
      return handleDeleteAccount(event);
    default:
      return { ok: false, message: '不支持的操作' };
  }
};
