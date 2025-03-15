import { Router, Request, Response } from 'express';
import StockPriceFetcher from "./utils/stockPriceFetcher";

const router = Router();

router.get('/', (req: Request, res: Response) => {
    res.send('hello world');
})

router.get('/getData', (req: Request, res: Response) => {
    StockPriceFetcher.getInstance().fetchAndSaveData(); 
    res.send('Get data success!');
});

export default router;