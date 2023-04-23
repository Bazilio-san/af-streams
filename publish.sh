#!/bin/bash

c='\033[0;35m'
y='\033[0;33m'
c0='\033[0;0m'
g='\033[0;32m'
set -e

npm run cb

echo 'END===================='
exit 0;

old_version=''
new_version=''

update_version(){
    old_version=`cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]'`
    echo -e "$c**** Old version is $g$old_version$c ****$c0"
    version_split=( ${old_version//./ } )
    major=${version_split[0]:-0}
    minor=${version_split[1]:-0}
    patch=${version_split[2]:-0}
    let "patch=patch+1"
    new_version="${major}.${minor}.${patch}"

    repo=`cat package.json | grep name | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]'`
    echo -e "$c**** Bumping version of $g$repo$c: $y$old_version$c -> $g$new_version$c  ****$c0"
    sed -i -e "0,/$old_version/s/$old_version/$new_version/" package.json
    echo -e "$g"
    npm version 2>&1 | head -2 | tail -1
    echo -e "$c0"
}

branch_name=$(git symbolic-ref --short HEAD)
retcode=$?

if [[ $retcode -ne 0 ]] ; then
    echo -e "$y**** Version will not be bumped since retcode is not equals 0 ****$c0"
    exit 0
fi

if [[ $branch_name == *"_nap" ]] ; then
    echo -e "$y**** Version will not be bumped since branch name ends with '_nap'. ****$c0"
    exit 0
fi

if [[ $branch_name == *"_local" ]] ; then
    echo -e "$y**** Version will not be bumped since branch name ends with '_local'. ****$c0"
    exit 0
fi

if [[ "$DONT_BUMP_VERSION" -eq "1" ]] ; then
    echo -e "$y**** Version will not be bumped since variable DONT_BUMP_VERSION is set. ****$c0"
    exit 0
fi

update_version
git add package.json
git commit -m "$new_version"

git push github refs/heads/master:master
git push fa refs/heads/master:master

npm publish
