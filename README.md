# OP-MAP


## Set Up Mail Server

1. Install postfix
2. Add IP of server to mynetwork field in /etc/postfix/main.cf for the postfix server to recognize request from the server
3. Set up the directory downloading nodejs, npm and all the relevant libraries in package.json.
4. Set up express server at port 3000
5. Set up mongodb datase
6. Enter following command to the terminal to allow for smtp relay.
*ip6tables -I OUTPUT -p tcp -m tcp --dport 25 -j DROP
iptables -t nat -I OUTPUT -o eth0 -p tcp -m tcp --dport 25 -j DNAT --to-destination 130.245.171.151:11587*
7. Start express server at port 3000
8. Forward port 80 request to 300 with the following command
*iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 80 -j REDIRECT --to-port 3000*
