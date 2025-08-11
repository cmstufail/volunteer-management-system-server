require( 'dotenv' ).config();
const express = require( 'express' );
const cors = require( 'cors' );
const jwt = require( 'jsonwebtoken' );
const cookieParser = require( 'cookie-parser' );
const { MongoClient, ServerApiVersion, ObjectId } = require( 'mongodb' );

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use( cors( {
    origin: [
        'https://volunteer-management-sys-a4e9f.web.app',
        'http://localhost:5173'

    ],
    credentials: true,
} ) );
app.use( express.json() );
app.use( cookieParser() );

const uri = `mongodb+srv://${ process.env.DB_USER }:${ process.env.DB_PASS }@cluster0.rsytxab.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB Client
const client = new MongoClient( uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
} );

// Middleware to verify JWT token
const verifyToken = ( req, res, next ) => {
    const token = req.cookies?.token;
    if ( !token ) return res.status( 401 ).send( { message: 'unauthorized access' } );

    jwt.verify( token, process.env.ACCESS_TOKEN_SECRET, ( err, decoded ) => {
        if ( err ) return res.status( 401 ).send( { message: 'unauthorized access' } );
        req.user = decoded;
        next();
    } );
};


// --- API Routes ---

// AUTH API
app.post( '/jwt', async ( req, res ) => {
    const user = req.body;
    const token = jwt.sign( user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' } );
    res.cookie( 'token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    } ).send( { success: true } );
} );

app.post( '/logout', async ( req, res ) => {
    res.clearCookie( 'token', {
        maxAge: 0,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    } ).send( { success: true } );
} );

// PUBLIC API
app.get( '/posts', async ( req, res ) => {
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
        const searchQuery = req.query.search || "";
        const query = searchQuery ? { postTitle: { $regex: searchQuery, $options: 'i' } } : {};
        const result = await postsCollection.find( query ).toArray();
        res.send( result );
    } catch ( error ) {
        console.error( "Error in /posts route:", error );
        res.status( 500 ).send( { message: "Server error fetching posts." } );
    }
} );

app.get( '/featured-posts', async ( req, res ) => {
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );

        const query = {};

        const cursor = postsCollection.find( query ).sort( { deadline: 1 } ).limit( 8 );
        const result = await cursor.toArray();
        res.send( result );
    } catch ( error ) {
        console.error( "Error in /featured-posts route:", error );
        res.status( 500 ).send( { message: "Internal Server Error" } );
    }
} );

// PRIVATE API
app.get( '/post/:id', verifyToken, async ( req, res ) => {
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
        const id = req.params.id;
        const query = { _id: new ObjectId( id ) };
        const result = await postsCollection.findOne( query );
        res.send( result );
    } catch ( error ) {
        console.error( "Error in /post/:id route:", error );
        res.status( 500 ).send( { message: "Server error fetching post." } );
    }
} );

app.get( '/my-posts/:email', verifyToken, async ( req, res ) => {
    if ( req.params.email !== req.user.email ) return res.status( 403 ).send( { message: 'forbidden access' } );
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
        const email = req.params.email;
        const query = { 'organizer.email': email };
        const result = await postsCollection.find( query ).toArray();
        res.send( result );
    } catch ( error ) {
        console.error( "Error in /my-posts/:email route:", error );
        res.status( 500 ).send( { message: "Server error." } );
    }
} );

app.get( '/my-volunteer-requests/:email', verifyToken, async ( req, res ) => {
    if ( req.params.email !== req.user.email ) return res.status( 403 ).send( { message: 'forbidden access' } );
    try {
        const requestsCollection = client.db( "volunteerDB" ).collection( 'volunteerRequests' );
        const email = req.params.email;
        const query = { volunteerEmail: email };
        const result = await requestsCollection.find( query ).toArray();
        res.send( result );
    } catch ( error ) {
        console.error( "Error in /my-volunteer-requests/:email route:", error );
        res.status( 500 ).send( { message: "Server error fetching requests." } );
    }
} );

app.get( '/manage-requests/:email', verifyToken, async ( req, res ) => {
    if ( req.params.email !== req.user.email ) return res.status( 403 ).send( { message: 'forbidden access' } );
    try {
        const requestsCollection = client.db( "volunteerDB" ).collection( 'volunteerRequests' );
        const email = req.params.email;
        const query = { organizerEmail: email };
        const result = await requestsCollection.find( query ).toArray();
        res.send( result );
    } catch ( error ) {
        console.error( "Error in /manage-requests/:email route:", error );
        res.status( 500 ).send( { message: "Server error." } );
    }
} );

app.post( '/posts', verifyToken, async ( req, res ) => {
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
        const postData = req.body;
        const newPost = { ...postData, deadline: new Date( postData.deadline ) };
        const result = await postsCollection.insertOne( newPost );
        res.send( result );
    } catch ( error ) {
        console.error( "Error in POST /posts route:", error );
        res.status( 500 ).send( { message: "Failed to add post." } );
    }
} );

app.post( '/request-volunteer', verifyToken, async ( req, res ) => {
    const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
    const requestsCollection = client.db( "volunteerDB" ).collection( 'volunteerRequests' );
    const applicationData = req.body;
    if ( req.user.email !== applicationData.volunteerEmail ) return res.status( 403 ).send( { message: 'forbidden access' } );

    const postId = applicationData.postId;
    const session = client.startSession();
    try {
        await session.withTransaction( async () => {
            await requestsCollection.insertOne( applicationData, { session } );
            await postsCollection.updateOne(
                { _id: new ObjectId( postId ) },
                { $inc: { volunteersNeeded: -1 } },
                { session }
            );
        } );
        res.send( { success: true, message: "Application submitted." } );
    } catch ( error ) {
        console.error( "Error in /request-volunteer route:", error );
        res.status( 500 ).send( { success: false, message: "Failed to submit application." } );
    } finally {
        await session.endSession();
    }
} );

app.put( '/post/:id', verifyToken, async ( req, res ) => {
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
        const id = req.params.id;
        const filter = { _id: new ObjectId( id ) };
        const updatedPostData = req.body;
        delete updatedPostData._id;
        const updateDoc = {
            $set: {
                ...updatedPostData,
                volunteersNeeded: parseInt( updatedPostData.volunteersNeeded ),
                deadline: new Date( updatedPostData.deadline ),
            }
        };
        const result = await postsCollection.updateOne( filter, updateDoc );
        res.send( result );
    } catch ( error ) {
        console.error( "Error in PUT /post/:id route:", error );
        res.status( 500 ).send( { message: "Failed to update post." } );
    }
} );

app.delete( '/post/:id', verifyToken, async ( req, res ) => {
    try {
        const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
        const id = req.params.id;
        const query = { _id: new ObjectId( id ) };
        const result = await postsCollection.deleteOne( query );
        res.send( result );
    } catch ( error ) {
        console.error( "Error in DELETE /post/:id route:", error );
        res.status( 500 ).send( { message: "Failed to delete post." } );
    }
} );

app.delete( '/request/:id', verifyToken, async ( req, res ) => {
    const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
    const requestsCollection = client.db( "volunteerDB" ).collection( 'volunteerRequests' );
    const requestId = req.params.id;
    const session = client.startSession();
    try {
        await session.withTransaction( async () => {
            const request = await requestsCollection.findOne( { _id: new ObjectId( requestId ) } );
            if ( !request ) throw new Error( "Request not found" );
            if ( req.user.email !== request.volunteerEmail ) throw new Error( "Forbidden access" );
            await requestsCollection.deleteOne( { _id: new ObjectId( requestId ) }, { session } );
            await postsCollection.updateOne(
                { _id: new ObjectId( request.postId ) },
                { $inc: { volunteersNeeded: 1 } },
                { session }
            );
        } );
        res.send( { success: true, message: "Request cancelled." } );
    } catch ( error ) {
        console.error( "Error in DELETE /request/:id route:", error );
        res.status( 500 ).send( { success: false, message: error.message || "Failed to cancel." } );
    } finally {
        await session.endSession();
    }
} );

app.patch( '/request/approve/:id', verifyToken, async ( req, res ) => {
    try {
        const requestsCollection = client.db( "volunteerDB" ).collection( 'volunteerRequests' );
        const id = req.params.id;
        const filter = { _id: new ObjectId( id ) };
        const updateDoc = { $set: { status: 'approved' } };
        const result = await requestsCollection.updateOne( filter, updateDoc );
        res.send( result );
    } catch ( error ) {
        console.error( "Error in PATCH /request/approve/:id route:", error );
        res.status( 500 ).send( { message: "Server error." } );
    }
} );

app.patch( '/request/reject/:id', verifyToken, async ( req, res ) => {
    const postsCollection = client.db( "volunteerDB" ).collection( "posts" );
    const requestsCollection = client.db( "volunteerDB" ).collection( 'volunteerRequests' );
    const requestId = req.params.id;
    const session = client.startSession();
    try {
        await session.withTransaction( async () => {
            const request = await requestsCollection.findOne( { _id: new ObjectId( requestId ) } );
            if ( !request ) throw new Error( "Request not found" );
            await requestsCollection.deleteOne( { _id: new ObjectId( requestId ) }, { session } );
            await postsCollection.updateOne(
                { _id: new ObjectId( request.postId ) },
                { $inc: { volunteersNeeded: 1 } },
                { session }
            );
        } );
        res.send( { success: true, message: "Request rejected." } );
    } catch ( error ) {
        console.error( "Error in PATCH /request/reject/:id route:", error );
        res.status( 500 ).send( { success: false, message: "Failed to reject request." } );
    } finally {
        await session.endSession();
    }
} );

app.post( '/contact-message', async ( req, res ) => {
    try {
        const contactMessagesCollection = client.db( "volunteerDB" ).collection( "contactMessages" );
        const messageData = req.body;
        const result = await contactMessagesCollection.insertOne( messageData );
        res.send( { success: true, insertedId: result.insertedId } );
    } catch ( error ) {
        console.error( "Error in /contact-message route:", error );
        res.status( 500 ).send( { success: false, message: "Failed to save message." } );
    }
} );

// Ping to check DB connection
app.get( '/db-ping', async ( req, res ) => {
    try {
        await client.db( "admin" ).command( { ping: 1 } );
        res.send( { success: true, message: "MongoDB connection is healthy." } );
    } catch ( error ) {
        res.status( 500 ).send( { success: false, message: "MongoDB connection failed." } );
    }
} );

app.get( '/', ( req, res ) => {
    res.send( 'Volunteer Management System Server is running' );
} );

app.listen( port, () => {
    console.log( `Server running on port: ${ port }` );
} );
