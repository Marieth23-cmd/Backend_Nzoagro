require('dotenv').config()
const conexao=require('./database')
const bcrypt= require('bcryptjs')

 async function seedAdmin(){
    const email= process.env.ADMIN_EMAIL
    const password=process.env.ADMIN_PASSWORD
    const hashPassword= await bcrypt.hash(password , 10)

    const[rows]= await conexao.promise().query('Select * from usuarios WHERE email=?' , [email])
    
    
    if(rows.length>0){
        console.log('Email já cadastrado' , rows)
        return
      }
      await conexao.promise().query(' Insert into usuarios( nome , email, senha , tipo_usuario) values(?,?,?,?)'
        ,['Administrador' , email,hashPassword,'Admin' ]
      )
      console.log('Administrador cadaastrado com sucesso')


}
seedAdmin().catch(err=> console.log(err))