import 'reflect-metadata';
import { Request, Response } from "express";

interface RequestWithBody extends Request {
  body: {
    [key: string]: string | undefined;
  };
}

function controller(target: any) {
    for (let key in target.prototype) {
        console.log(Reflect.getMetadata('path', target.prototype, key));
    }
}

function get(path: string) {
    return function(target: any, key: string) {
        Reflect.defineMetadata('path', path, target, key);
    };
}

@controller
class LoginController {

  @get('/login')
  login() {

  }

  @get('/')
  home(req: RequestWithBody, res: Response) {
    const isLogin = req.session ? req.session.login : false;
    if (isLogin) {
      res.send(`
        <html>
            <body>
                <a href='/getData'>Get Data</a>
                <a href='/showData'>Show Data</a>
                <a href='/logout'>Log Out</a>
            </body>
        </html>
    `);
    } else {
      res.send(`
        <html>
            <body>
                <form method="post" action="/login">
                    <input type="password" name="password" />
                    <button>Log In</button>
                </form>
            </body>
        </html>
    `);
    }
  }
}