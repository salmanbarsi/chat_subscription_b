import express from "express";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";
import { PubSub } from "graphql-subscriptions";
import gql from "graphql-tag";
import { makeExecutableSchema } from "@graphql-tools/schema";
import bodyParser from "body-parser";
import cors from "cors";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config();

const port =  process.env.PORT || 5005;
const client = neon(process.env.DATABASE_URL);
const pubsub = new PubSub();
const MESSAGE_SENT = "MESSAGE_SENT";

const typeDefs = gql`
  type Message {
    id: ID!
    user: String!
    text: String!
    timestamp: String!
  }

  type Query {
    messages: [Message!]!
  }

  type Mutation {
    sendMessage(user: String!, text: String!): Message!
  }

  type Subscription {
    messageSent: Message!
  }
`;

const resolvers = {
  Query: {
    messages: async () => {
      const result = await client`SELECT * FROM messages ORDER BY id ASC`;
      return result.map((row) => ({
        id: row.id,
        user: row.username,
        text: row.text,
        timestamp: row.timestamp,
      }));
    },
  },
  Mutation: {
    sendMessage: async (_, { user, text }) => {
      const result = await client.query(
        "INSERT INTO messages (username, text) VALUES ($1, $2) RETURNING *",
        [user, text]
      );

      const newMessage = {
        id: result[0].id,
        user: result[0].username,
        text: result[0].text,
        timestamp: result[0].timestamp,
      };

      pubsub.publish(MESSAGE_SENT, { messageSent: newMessage });
      return newMessage;
    },
  },
  Subscription: {
    messageSent: {
        subscribe: () => pubsub.asyncIterableIterator([MESSAGE_SENT]),
    },
  },
};



const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
app.use(cors());
const httpServer = createServer(app);

const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});
useServer({ schema }, wsServer);

const server = new ApolloServer({
  schema,
});
await server.start();

app.use("/graphql", bodyParser.json(), expressMiddleware(server));

httpServer.listen(port, () => {
  console.log(`🚀 HTTP ready at http://localhost:${port}/graphql`);
  console.log(`🔄 Subscriptions ready at ws://localhost:${port}/graphql`);
});
