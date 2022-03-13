import * as dotenv from 'dotenv';

dotenv.config();

const setup = async () => {
  process.env.NODE_ENV = 'test';
};

export default setup;
